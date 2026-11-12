/**
 * Course kit card logic (2026-11-12). Pure, no React Native imports, so it is
 * unit-tested with node --test.
 *
 * Contract (NestJS GET /kits/course/:courseId, wrapped by ResponseInterceptor):
 *   { success, message, data }
 *   data = { course_id, kit: null }                                   no kit
 *   data = { course_id, kit: { id, name, description, items[], all_available },
 *            kit_included, kit_purchase_required, label }
 *   items[] = { product_id, title, slug, quantity, price, image, available }
 * `price` is a Prisma Decimal serialised with JSON.stringify, so it normally
 * arrives as a string ("499"); numbers are accepted too.
 */

export interface CourseKitItem {
  product_id: string;
  title: string;
  slug: string;
  quantity: number;
  /** Unit price in rupees, or null when the server sent no usable price. */
  price: number | null;
  image: string | null;
  available: boolean;
}

export interface CourseKit {
  id: string;
  name: string;
  description: string | null;
  items: CourseKitItem[];
  all_available: boolean;
}

export interface CourseKitResponse {
  course_id: string;
  kit: CourseKit;
  kit_included: boolean;
  kit_purchase_required: boolean;
  label?: string;
}

function toPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toQuantity(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Reads the course-kit API body. Returns null when there is no kit or the
 * payload is not usable, which the screen treats as "no kit card".
 */
export function parseCourseKitPayload(payload: unknown): CourseKitResponse | null {
  const body = payload as any;
  if (!body || typeof body !== "object") return null;
  if (body.success === false) return null;
  const data = body.data;
  if (!data || typeof data !== "object") return null;
  const kit = data.kit;
  if (!kit || typeof kit !== "object" || !Array.isArray(kit.items)) return null;

  const items: CourseKitItem[] = [];
  for (const raw of kit.items) {
    if (!raw || raw.product_id === undefined || raw.product_id === null) return null;
    const quantity = toQuantity(raw.quantity);
    if (quantity === null) return null;
    items.push({
      product_id: String(raw.product_id),
      title: typeof raw.title === "string" ? raw.title : "Kit item",
      slug: typeof raw.slug === "string" ? raw.slug : "",
      quantity,
      price: toPrice(raw.price),
      image: typeof raw.image === "string" && raw.image ? raw.image : null,
      available: raw.available === true,
    });
  }
  if (items.length === 0) return null;

  const allAvailable =
    typeof kit.all_available === "boolean"
      ? kit.all_available && items.every((i) => i.available)
      : items.every((i) => i.available);

  return {
    course_id: String(data.course_id ?? ""),
    kit: {
      id: String(kit.id ?? ""),
      name: typeof kit.name === "string" && kit.name ? kit.name : "Course kit",
      description: typeof kit.description === "string" && kit.description ? kit.description : null,
      items,
      all_available: allAvailable,
    },
    kit_included: data.kit_included === true,
    kit_purchase_required: data.kit_purchase_required === true,
    label: typeof data.label === "string" ? data.label : undefined,
  };
}

/** Sum of price × quantity, or null if any item has no usable price. */
export function kitTotal(kit: Pick<CourseKit, "items">): number | null {
  let total = 0;
  for (const item of kit.items) {
    if (item.price === null) return null;
    total += item.price * item.quantity;
  }
  return Math.round(total * 100) / 100;
}

export function formatRupees(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export type KitCardMode = "included" | "separate";

/** kit_included true → "included" (no prices shown); otherwise sold separately. */
export function kitCardMode(kit: CourseKitResponse): KitCardMode {
  return kit.kit_included ? "included" : "separate";
}

export type KitCartAction =
  | { kind: "none" }
  | { kind: "unavailable"; label: "Kit currently unavailable" }
  | { kind: "add"; label: string; total: number };

/**
 * What the "add kit" control shows. Only for kits sold separately (free
 * courses). Respects kit.all_available; without a complete price list the
 * button is not offered.
 */
export function kitCartAction(kit: CourseKitResponse): KitCartAction {
  if (kit.kit_included || !kit.kit_purchase_required) return { kind: "none" };
  if (!kit.kit.all_available) return { kind: "unavailable", label: "Kit currently unavailable" };
  const total = kitTotal(kit.kit);
  if (total === null) return { kind: "unavailable", label: "Kit currently unavailable" };
  return { kind: "add", label: `Add kit to cart · ₹${formatRupees(total)}`, total };
}

/**
 * Merges kit lines into existing cart lines. Same rule as the existing cart
 * (a product already in the cart has its quantity increased; new products are
 * appended), applied with the kit's quantity instead of +1.
 */
export function mergeCartLines<P extends { id: string }>(
  existing: { product: P; quantity: number }[],
  additions: { product: P; quantity: number }[],
): { product: P; quantity: number }[] {
  const next = existing.map((line) => ({ ...line }));
  for (const add of additions) {
    if (!Number.isInteger(add.quantity) || add.quantity <= 0) continue;
    const line = next.find((l) => String(l.product.id) === String(add.product.id));
    if (line) line.quantity += add.quantity;
    else next.push({ product: add.product, quantity: add.quantity });
  }
  return next;
}

export type KitAddOutcome<P> =
  | { ok: true; entries: { product: P; quantity: number }[] }
  | { ok: false; reason: "load_failed" | "unavailable" | "cart_rejected" };

/**
 * The kit "Add to cart" decision (2026-11-12), used by components/CourseKitCard.tsx
 * and tested directly. All or nothing:
 *  1. Load every kit product. If any load throws → "load_failed"; nothing is added.
 *  2. If any product is missing (null), out of stock, or not a physical store
 *     product → "unavailable"; nothing is added.
 *  3. Otherwise call addItemsToCart ONCE with every product and its kit
 *     quantity. If the cart refuses the batch → "cart_rejected".
 * addItemsToCart is never called on a failure path, so the existing cart is
 * left exactly as it was.
 */
export async function addKitToCart<P extends { inStock: boolean }>(opts: {
  items: { product_id: string; quantity: number }[];
  loadProduct: (productId: string) => Promise<P | null>;
  isPhysical: (product: P) => boolean;
  addItemsToCart: (entries: { product: P; quantity: number }[]) => boolean;
}): Promise<KitAddOutcome<P>> {
  let products: (P | null)[];
  try {
    products = await Promise.all(opts.items.map((item) => opts.loadProduct(item.product_id)));
  } catch {
    return { ok: false, reason: "load_failed" };
  }
  const entries: { product: P; quantity: number }[] = [];
  for (let i = 0; i < opts.items.length; i++) {
    const product = products[i];
    if (!product || !product.inStock || !opts.isPhysical(product)) {
      return { ok: false, reason: "unavailable" };
    }
    entries.push({ product, quantity: opts.items[i].quantity });
  }
  if (entries.length === 0 || !opts.addItemsToCart(entries)) {
    return { ok: false, reason: "cart_rejected" };
  }
  return { ok: true, entries };
}

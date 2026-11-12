import { isPhysicalStoreProduct } from "@/constants/commerce";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { Product } from "@/data/mockData";
import { mergeCartLines } from "@/lib/courseKit";

interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product) => void;
  /** Adds several products with quantities in one update (course kits). All or nothing. */
  addItemsToCart: (entries: { product: Product; quantity: number }[]) => boolean;
  removeFromCart: (productId: string) => void;
  decrementQuantity: (productId: string) => void;
  clearCart: () => void;
  total: number;
  count: number;
}

const CartContext = createContext<CartContextType | null>(null);

const STORAGE_KEY = "@makersflow_cart";
// Bump this number whenever the Product schema changes to invalidate stale caches.
const CART_VERSION = 2;

interface PersistedCart {
  version: number;
  items: CartItem[];
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const lastAddRef = useRef<number>(0);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed: PersistedCart = JSON.parse(raw);
        // Only restore cart if the stored version matches the current schema version.
        // If the version is missing or outdated (i.e. stale mock data), discard it.
        if (parsed && parsed.version === CART_VERSION && Array.isArray(parsed.items)) {
          // C-5: drop any digital items persisted by an older app version.
          setItems(parsed.items.filter((i: any) => i && isPhysicalStoreProduct(i.product)));
        } else {
          // Stale / mock data — wipe it so checkout never shows old snapshots.
          AsyncStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        AsyncStorage.removeItem(STORAGE_KEY);
      }
    });
  }, []);

  function save(updated: CartItem[]) {
    setItems(updated);
    const payload: PersistedCart = { version: CART_VERSION, items: updated };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function addToCart(product: Product) {
    // C-5: digital goods cannot be bought in-app (Play Payments policy).
    if (!isPhysicalStoreProduct(product as any)) return;
    const now = Date.now();
    if (now - lastAddRef.current < 500) {
      return; // prevent duplicate clicks within 500ms
    }
    lastAddRef.current = now;

    const existing = items.find((i) => i.product.id === product.id);
    if (existing) {
      save(items.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      save([...items, { product, quantity: 1 }]);
    }
  }

  /**
   * Course kit (2026-11-12): adds every entry with its quantity in a single
   * functional update, so nothing is lost to the 500 ms add debounce or to a
   * stale `items` closure. Same duplicate rule as addToCart (an existing line's
   * quantity is increased). C-5: refuses the whole batch if any entry is not a
   * physical store product or has an invalid quantity.
   */
  function addItemsToCart(entries: { product: Product; quantity: number }[]): boolean {
    if (entries.length === 0) return false;
    const valid = entries.every(
      (e) => isPhysicalStoreProduct(e.product as any) && Number.isInteger(e.quantity) && e.quantity > 0,
    );
    if (!valid) return false;
    setItems((prev) => {
      const next = mergeCartLines(prev, entries);
      const payload: PersistedCart = { version: CART_VERSION, items: next };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return next;
    });
    return true;
  }

  function decrementQuantity(productId: string) {
    const existing = items.find((i) => i.product.id === productId);
    if (!existing) return;
    if (existing.quantity <= 1) {
      removeFromCart(productId);
    } else {
      save(items.map((i) => (i.product.id === productId ? { ...i, quantity: i.quantity - 1 } : i)));
    }
  }

  function removeFromCart(productId: string) {
    save(items.filter((i) => i.product.id !== productId));
  }

  function clearCart() {
    save([]);
  }

  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, addItemsToCart, removeFromCart, decrementQuantity, clearCart, total, count }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

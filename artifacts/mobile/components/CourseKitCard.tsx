/**
 * Course kit card (2026-11-12), shown at the top of the course details
 * content, above the tabs and description. Moved out of app/course/[id].tsx
 * with the same styling, then extended.
 *
 * - kit_included true  → green "Kit included with course", no prices.
 * - kit_included false → amber "Kit sold separately", item prices, total and
 *   "Add kit to cart · ₹total" (disabled "Kit currently unavailable" when
 *   kit.all_available is false).
 * The screen renders this only when GET /kits/course/:id returned a kit, so a
 * course without a kit looks exactly as before.
 *
 * Add to cart reuses the existing cart and checkout: each product is loaded
 * with productService.getProductById (the same Product shape the store uses)
 * and the kit is added in one all-or-nothing cart update.
 */
import React, { useRef, useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { IncludedKitClaim } from "@/components/IncludedKitClaim";
import { isPhysicalStoreProduct } from "@/constants/commerce";
import { useCart } from "@/context/CartContext";
import type { Product } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import { addKitToCart, formatRupees, kitCardMode, kitCartAction, type CourseKitResponse } from "@/lib/courseKit";
import { productService } from "@/services/productService";

export function CourseKitCard({ courseId, courseKit }: { courseId: string; courseKit: CourseKitResponse }) {
  const colors = useColors();
  const { addItemsToCart } = useCart();
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const included = kitCardMode(courseKit) === "included";
  const cartAction = kitCartAction(courseKit);

  async function handleAddKit() {
    if (cartAction.kind !== "add" || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      // All-or-nothing decision lives in lib/courseKit.ts (addKitToCart), tested directly.
      const outcome = await addKitToCart<Product>({
        items: courseKit.kit.items,
        loadProduct: (productId) => productService.getProductById(productId),
        isPhysical: (product) => isPhysicalStoreProduct(product as any),
        addItemsToCart,
      });
      if (outcome.ok) {
        Alert.alert("Kit added to cart", `${courseKit.kit.name} is in your cart.`, [
          { text: "Continue", style: "cancel" },
          { text: "View cart", onPress: () => router.push("/cart") },
        ]);
      } else if (outcome.reason === "load_failed") {
        Alert.alert("Couldn't add the kit", "Please check your connection and try again.");
      } else if (outcome.reason === "unavailable") {
        Alert.alert("Kit currently unavailable", "One of the kit items can't be added right now. Please try again later.");
      } else {
        Alert.alert("Kit currently unavailable", "The kit couldn't be added to your cart. Please try again later.");
      }
    } catch {
      Alert.alert("Couldn't add the kit", "Please check your connection and try again.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  return (
    <View style={{
      marginTop: 16,
      marginBottom: 16,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      gap: 12,
    }}>
      <View style={{
        alignSelf: "flex-start",
        backgroundColor: included ? "#DCFCE7" : "#FEF3C7",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
      }}>
        <Text style={{
          color: included ? "#166534" : "#92400E",
          fontSize: 12,
          fontFamily: "Inter_600SemiBold",
        }}>
          {included ? "Kit included with course" : "Kit sold separately"}
        </Text>
      </View>

      <Text style={{
        color: colors.foreground,
        fontSize: 18,
        fontFamily: "Inter_600SemiBold",
      }}>
        {courseKit.kit.name}
      </Text>

      {!!courseKit.kit.description && (
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          {courseKit.kit.description}
        </Text>
      )}

      {courseKit.kit.items.map((item) => {
        const image = item.image && !brokenImages.has(item.product_id) ? item.image : null;
        return (
          <View key={item.product_id} style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 6,
          }}>
            {image ? (
              <Image
                source={{ uri: image }}
                style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: colors.muted }}
                resizeMode="cover"
                onError={() => {
                  setBrokenImages((current) => new Set(current).add(item.product_id));
                }}
              />
            ) : (
              <View style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                backgroundColor: colors.muted,
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Ionicons name="cube-outline" size={22} color={colors.mutedForeground} />
              </View>
            )}

            <View style={{ flex: 1, gap: 3 }}>
              <Text numberOfLines={2} style={{
                color: colors.foreground,
                fontSize: 14,
                fontFamily: "Inter_600SemiBold",
              }}>
                {item.title}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {`Qty ${item.quantity}${!included && item.price != null ? ` · ₹${formatRupees(item.price)} each` : ""}`}
              </Text>
              {!item.available && (
                <Text style={{ color: "#DC2626", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
                  Out of stock
                </Text>
              )}
            </View>
          </View>
        );
      })}

      {!courseKit.kit.all_available && (
        <Text style={{ color: "#DC2626", fontSize: 13 }}>
          Some kit items are currently out of stock.
        </Text>
      )}

      {!included && cartAction.kind === "add" && (
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>
          {`Total ₹${formatRupees(cartAction.total)}`}
        </Text>
      )}

      <Text style={{
        color: colors.mutedForeground,
        fontSize: 13,
        lineHeight: 19,
      }}>
        {included
          ? "Learners enrolled in this course receive this kit at no extra cost."
          : "This course is free. The kit isn't included and is available separately."}
      </Text>

      {cartAction.kind !== "none" && (
        <Pressable
          onPress={() => void handleAddKit()}
          disabled={cartAction.kind !== "add" || adding}
          accessibilityRole="button"
          accessibilityState={{ disabled: cartAction.kind !== "add" || adding }}
          style={{
            backgroundColor: cartAction.kind === "add" ? "#0B6FAD" : colors.muted,
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: "center",
            opacity: adding ? 0.6 : 1,
          }}
        >
          <Text style={{
            color: cartAction.kind === "add" ? "#FFF" : colors.mutedForeground,
            fontFamily: "Inter_600SemiBold",
          }}>
            {adding ? "Adding kit…" : cartAction.label}
          </Text>
        </Pressable>
      )}

      {/* Not released: renders nothing while FEATURE_FLAGS.INCLUDED_KIT_CLAIM is false. */}
      {included && <IncludedKitClaim courseId={courseId} />}
    </View>
  );
}

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, Alert, Platform, Dimensions } from "react-native";
import { Image } from "expo-image";
import { Product } from "@/data/mockData";
import { getOptimizedImageUrl } from "@/lib/thumbnailUtils";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";
import { useFavorites } from "@/context/FavoritesContext";
import { useRequireAuth } from "@/context/AuthRequireContext";

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;

interface ProductCardProps {
  product: Product & { images?: string[] };
  onAddedToCart?: () => void;
  gridMode?: boolean;
  variant?: "flat" | "boxed";
}

export const ProductCard = React.memo(function ProductCard({ product, onAddedToCart, gridMode = false, variant = "boxed" }: ProductCardProps) {
  const colors = useColors();
  const { addToCart } = useCart();
  const { isProductInWishlist, toggleWishlistProduct } = useFavorites();
  const { requireAuth } = useRequireAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(CARD_WIDTH);
  const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
  const isWishlisted = isProductInWishlist(product.id);
  const isFlat = variant === "flat";

  const renderStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating || 0);
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Ionicons
          key={i}
          name={i <= fullStars ? "star" : "star-outline"}
          size={11}
          color="#F59E0B"
        />
      );
    }
    return stars;
  };

  const handleToggleWishlist = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    requireAuth(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const wasWishlisted = isWishlisted;
      await toggleWishlistProduct(product.id);
      const message = wasWishlisted
        ? `${product.title} removed from wishlist`
        : `${product.title} added to wishlist`;
      if (Platform.OS === 'android') {
        const { ToastAndroid } = require('react-native');
        ToastAndroid.show(message, ToastAndroid.SHORT);
      } else {
        Alert.alert('', message);
      }
    });
  };

  const handleAddToCart = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isAdding) return;
    
    requireAuth(async () => {
      setIsAdding(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      addToCart(product);
      
      if (onAddedToCart) {
        onAddedToCart();
      }
      
      if (Platform.OS !== "web") {
        Alert.alert("Added to cart", `${product.title} has been added to your cart`);
      }
      
      setTimeout(() => setIsAdding(false), 500);
    });
  };

  const productImages = product.images && Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : null;


  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        gridMode && styles.gridCard,
        isFlat ? styles.flatCard : { backgroundColor: colors.card, borderColor: colors.border },
        { opacity: pressed ? 0.8 : 1 },
      ]}
      onPress={() => router.push({ pathname: "/store/[id]", params: { id: product.id } })}
    >
      <View style={[styles.imageContainer, isFlat && { borderRadius: 8 }]} onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
        {productImages ? (
          <View style={{ flex: 1 }}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / (containerWidth || CARD_WIDTH));
                setActiveIndex(index);
              }}
              style={{ width: containerWidth || CARD_WIDTH, height: 120 }}
              contentContainerStyle={{ height: 120 }}
            >
              {productImages.map((item: any, index: number) => {
                const src = typeof item === "string" ? { uri: item } : item;
                return (
                  <Image
                    key={`img_${index}`}
                    source={getOptimizedImageUrl(src, { width: 400, height: 260 })}
                    cachePolicy="memory-disk"
                    style={{ width: containerWidth || CARD_WIDTH, height: 120 }}
                    contentFit="cover"
                    transition={200}
                  />
                );
              })}
            </ScrollView>
            {productImages.length > 1 && (
              <View style={styles.paginationDots}>
                {productImages.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i === activeIndex ? "#0B6FAD" : "#D6E9F2" }
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <Image source={getOptimizedImageUrl(product.thumbnail, { width: 400, height: 260 })} cachePolicy="memory-disk" style={styles.thumbnail} contentFit="cover" transition={200} />
        )}
        {product.badge && (
          <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
            <Text style={styles.badgeText}>{product.badge}</Text>
          </View>
        )}
        
        {/* Wishlist heart top-right of image */}
        <Pressable
          style={styles.imageHeartBtn}
          onPress={handleToggleWishlist}
        >
          <Ionicons
            name={isWishlisted ? "heart" : "heart-outline"}
            size={16}
            color={isWishlisted ? "#EF4444" : "#9CA3AF"}
          />
        </Pressable>

        {/* Out of Stock overlay */}
        {!product.inStock && (
          <View style={styles.outOfStockOverlay}>
            <View style={styles.outOfStockPill}>
              <Text style={styles.outOfStockText}>Out of Stock</Text>
            </View>
          </View>
        )}
      </View>
      <View style={isFlat ? styles.flatContent : styles.content}>
        {isFlat ? (
          <View style={[styles.categoryPill, { backgroundColor: colors.accent }]}>
            <Text style={[styles.categoryText, { color: colors.primary }]}>{product.subcategory}</Text>
          </View>
        ) : (
          <Text style={[styles.subcategory, { color: colors.mutedForeground }]}>{product.subcategory}</Text>
        )}
        
        <Text style={[
          isFlat ? styles.flatTitle : styles.title,
          { color: colors.foreground }
        ]} numberOfLines={2}>
          {product.title}
        </Text>

        {product.reviews > 0 && product.rating > 0 ? (
          <View style={styles.ratingRow}>
            <View style={styles.starsContainer}>
              {renderStars(product.rating)}
            </View>
            {isFlat && (
              <Text style={[styles.ratingNumber, { color: colors.mutedForeground }]}>
                {product.rating}
              </Text>
            )}
            <Text style={[styles.reviews, { color: colors.mutedForeground }]}>
              ({product.reviews})
            </Text>
          </View>
        ) : null}

        <View style={styles.priceRow}>
          <View style={styles.priceGroup}>
            <Text style={[
              isFlat ? styles.flatPrice : styles.price,
              { color: isFlat ? colors.foreground : "#0B6FAD" }
            ]} numberOfLines={1}>
              ₹{product.price}
            </Text>
            {discount > 0 && (
              <Text style={[styles.originalPrice, { color: colors.mutedForeground }]} numberOfLines={1}>
                ₹{product.originalPrice}
              </Text>
            )}
          </View>
          
          {/* Add to Cart Pill button */}
          <Pressable
            style={[styles.addCartPillBtn, { opacity: product.inStock ? 1 : 0.5 }]}
            onPress={handleAddToCart}
            disabled={!product.inStock}
          >
            <Ionicons name="cart" size={12} color="#FFF" />
            <Text style={styles.addCartPillText}>Add</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    marginRight: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },
  gridCard: {
    marginRight: 0,
    width: "100%",
  },
  flatCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 0,
    borderColor: "transparent",
  },
  imageContainer: {
    position: "relative",
    height: 120,
    width: "100%",
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Fredoka_700Bold",
    color: "#FFFFFF",
  },
  imageHeartBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  outOfStockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockPill: {
    backgroundColor: "#EF4444",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  outOfStockText: {
    fontSize: 10,
    fontFamily: "Fredoka_700Bold",
    color: "#FFF",
  },
  content: {
    padding: 12,
    gap: 4,
  },
  subcategory: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    lineHeight: 18,
    height: 36,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  starsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  reviews: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 8,
  },
  priceGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  price: {
    fontSize: 15,
    fontFamily: "Fredoka_700Bold",
  },
  originalPrice: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textDecorationLine: "line-through",
  },
  addCartPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#0B6FAD",
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
  },
  addCartPillText: {
    fontSize: 11,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  paginationDots: {
    position: "absolute",
    bottom: 6,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  flatContent: {
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
  },
  flatTitle: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  flatPrice: {
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
    flex: 1,
  },
  categoryPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: "600",
  },
  ratingNumber: {
    fontSize: 11,
    fontWeight: "700",
  },
});

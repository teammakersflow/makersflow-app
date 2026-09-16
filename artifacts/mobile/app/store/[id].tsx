import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFavorites } from "@/context/FavoritesContext";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useRequireAuth } from "@/context/AuthRequireContext";
import React, { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Share,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useCart } from "@/context/CartContext";
import { Product } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import { cacheManager } from "@/services/cacheManager";
import { productService } from "@/services/productService";
import { StarRating } from "@/components/StarRating";
import { ImageGallery } from "@/components/ImageGallery";
import { parseThumbnailUrls } from "@/lib/thumbnailUtils";
import { useAuth } from "@/context/AuthContext";
import { orderService } from "@/services/orderService";
import { ApiError } from "@/lib/auth/apiClient";
import {
  fetchProductReviews,
  fetchMyProductReview,
  upsertProductReview,
  type ProductReview,
} from "@/services/productReviewService";
import { ActivityIndicator, TextInput } from "react-native";

function isNetworkOrUnavailable(err: any): boolean {
  if (!err) return false;
  if (err instanceof ApiError) {
    return err.status === 0 || err.status === 408 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  return err.name === 'AbortError' || (typeof err.message === 'string' && err.message.toLowerCase().includes('network'));
}

const productFallbacks: Record<string, any[]> = {
  physical: [
    require('@/assets/images/products/product_kit_1.webp'),
    require('@/assets/images/products/product_kit_2.webp'),
    require('@/assets/images/products/product_kit_3.webp'),
  ],
  digital: [
    require('@/assets/images/product_notes_1.webp'),
    require('@/assets/images/product_notes_2.webp'),
    require('@/assets/images/product_notes_3.webp'),
  ]
};

const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|avi)(\?.*)?$/i;

/**
 * Extract a normalized image list from a product row, tolerating every
 * shape the admin portal may save media in:
 *  - `images` / `media` / `image_urls` / `media_urls` / `gallery` columns
 *  - JSON strings or real arrays
 *  - arrays of URL strings OR arrays of objects ({url|uri|src|publicUrl|public_url|path, type})
 * Videos are filtered out (the slider only renders <Image>).
 * The thumbnail is always included first and duplicates are removed.
 */
function extractProductImages(row: any, thumbnail: any): any[] {
  const candidates = [
    row.images,
    row.media,
    row.image_urls,
    row.media_urls,
    row.gallery,
    row.thumbnail_url,
  ];
  const urls: string[] = [];

  for (let raw of candidates) {
    if (raw == null) continue;
    if (typeof raw === 'string') {
      const parsed = parseThumbnailUrls(raw);
      for (const u of parsed) {
        if (u.startsWith('http') && !VIDEO_EXT_RE.test(u)) {
          urls.push(u);
        }
      }
      continue;
    }
    if (!Array.isArray(raw)) raw = [raw];

    for (const item of raw) {
      let url: string | null = null;
      if (typeof item === 'string') {
        url = item;
      } else if (item && typeof item === 'object') {
        if (typeof item.type === 'string' && item.type.toLowerCase().includes('video')) continue;
        url = item.url || item.uri || item.src || item.publicUrl || item.public_url || item.path || null;
      }
      if (url && typeof url === 'string' && url.startsWith('http') && !VIDEO_EXT_RE.test(url)) {
        urls.push(url);
      }
    }
  }

  // De-dupe while preserving order; put the thumbnail URL first if we have one
  const thumbUrl: string | null = thumbnail && thumbnail.uri ? thumbnail.uri : null;
  const ordered = thumbUrl ? [thumbUrl, ...urls.filter((u) => u !== thumbUrl)] : urls;
  const unique = Array.from(new Set(ordered));

  if (unique.length > 0) return unique.map((u) => ({ uri: u }));
  return [thumbnail];
}

function mapSupabaseProduct(row: any): Product {
  const isDigital = row.category?.toLowerCase() === 'digital' || 
                    row.subcategory?.toLowerCase() === 'notes' ||
                    row.subcategory?.toLowerCase() === 'question banks' ||
                    row.subcategory?.toLowerCase() === 'premium resources';
  const category = isDigital ? 'digital' : 'physical';
  
  let subcategory = row.subcategory;
  if (!subcategory) {
    subcategory = isDigital ? "Notes" : "Physical Kits";
  }

  let hash = 0;
  const idStr = String(row.id);
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash);

  const thumbnail = row.thumbnail_url 
    ? { uri: row.thumbnail_url } 
    : (productFallbacks[category] || productFallbacks.physical)[index % 3];

  const images = extractProductImages(row, thumbnail);

  return {
    id: String(row.id),
    title: row.title || "Untitled Product",
    category,
    subcategory,
    price: Number(row.price) || 0,
    originalPrice: Number(row.original_price) || Number(row.price) || 0,
    thumbnail,
    images,
    description: row.description || "No description available.",
    rating: Number(row.rating) || 0,
    reviews: Number(row.total_reviews) || 0,
    inStock: (row.in_stock === false || row.status === 'sold_out' || row.status === 'out_of_stock') ? false : Boolean(row.in_stock ?? true),
    badge: row.badge || undefined,
    features: Array.isArray(row.features) ? row.features : [],
  };
}

export default function ProductDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  // useLocalSearchParams can return string | string[] | undefined — normalise to a clean string
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = rawId && rawId !== 'undefined' && !isNaN(Number(rawId)) ? rawId : undefined;
  const { addToCart, items, decrementQuantity } = useCart();
  const { isProductInWishlist, toggleWishlistProduct } = useFavorites();
  const { requireAuth } = useRequireAuth();

  const isWishlisted = isProductInWishlist(String(id));
  const [localQty, setLocalQty] = useState(1);
  const [activeSlide, setActiveSlide] = useState(0);
  const { width: screenWidth } = Dimensions.get("window");

  const { user } = useAuth();
  const [allReviews, setAllReviews] = useState<ProductReview[]>([]);
  const [myReview, setMyReview] = useState<ProductReview | null>(null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  // Review form states
  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  const handleSubmitReview = async () => {
    if (!user?.id || !id || draftRating === 0) return;
    setReviewSubmitting(true);
    try {
      await upsertProductReview(user.id, id, draftRating, draftComment);
      setReviewSubmitted(true);
      
      // Reload reviews
      const reviewsData = await fetchProductReviews(id);
      setAllReviews(reviewsData);
      
      const myReviewData = await fetchMyProductReview(user.id, id);
      setMyReview(myReviewData);
      
      if (reviewsData.length > 0) {
        const sum = reviewsData.reduce((acc, r) => acc + r.rating, 0);
        setAvgRating(sum / reviewsData.length);
      } else {
        setAvgRating(null);
      }
      
      Alert.alert("Success", "Your review has been submitted for moderation.");
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to submit review. Please try again.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleToggleWishlist = async () => {
    requireAuth(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await toggleWishlistProduct(String(id));
      } catch (err: any) {
        if (Platform.OS === 'android') {
          const { ToastAndroid } = require('react-native');
          ToastAndroid.show('Could not update wishlist', ToastAndroid.SHORT);
        } else {
          Alert.alert('Wishlist', 'Could not update wishlist. Please try again.');
        }
      }
    });
  };

  const handleShare = async () => {
    try {
      await Share.share({
        title: product?.title,
        message: `Check out "${product?.title || "this product"}" on MakersFlow!\n\nOpen in app: makersflow://store/${id}\n\nDownload MakersFlow: https://play.google.com/store/apps/details?id=com.makersflow.app`,
      });
    } catch (error) {
      console.error("[ProductShare] Share failed error:", error);
    }
  };

  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [isOfflineCached, setIsOfflineCached] = useState(false);

  const loadProduct = useCallback(async (isRefreshing = false, cancelledRef = { current: false }) => {
    if (!id || isNaN(Number(id))) {
      console.warn('[ProductDetail] Invalid or missing product id:', id);
      setIsLoading(false);
      return;
    }
    if (!isRefreshing) {
      setIsLoading(true);
    }

    const cacheKey = `cached_product_detail_${id}`;
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

    try {
      const data = await productService.getProductById(id);

      if (!data) {
        console.warn('[ProductDetail] Live product query failed or missing, checking offline cache...');
        const cached = await cacheManager.read<any>(cacheKey, CACHE_TTL);
        if (cached && !cancelledRef.current) {
          setIsOfflineCached(true);
          setProduct(cached);
          setIsLoading(false);
          setRefreshing(false);
          return;
        }
        if (!cancelledRef.current) setIsLoading(false);
        return;
      }

      const mapped = data;
      if (!cancelledRef.current) {
        await cacheManager.write(cacheKey, mapped);
        setIsOfflineCached(false);
        setProduct(mapped);
        setIsLoading(false);
        setRefreshing(false);
      }

      // Parallelize all secondary below-the-fold requests in a single parallel batch
      const imagesList = mapped.images ?? [];
      const mediaPromise = imagesList.length <= 1
        ? supabase.from('product_media').select('*').eq('product_id', Number(id))
        : Promise.resolve({ data: null, error: null });

      const reviewsPromise = fetchProductReviews(id);

      const myReviewPromise = user?.id
        ? fetchMyProductReview(user.id, id)
        : Promise.resolve(null);

      const ordersPromise = user?.id
        ? (async () => {
            try {
              const myOrders = await orderService.getMyOrders();
              return { data: myOrders, error: null };
            } catch (err: any) {
              if (isNetworkOrUnavailable(err)) {
                console.warn('[ProductDetail] NestJS orders unavailable, attempting Supabase fallback:', err?.message || err);
                return supabase
                  .from("orders")
                  .select("items, status")
                  .eq("user_id", user.id)
                  .in("status", ["paid", "completed"]);
              }
              console.error('[ProductDetail] NestJS /orders/my error (not masked):', err);
              return { data: null, error: err };
            }
          })()
        : Promise.resolve({ data: null, error: null });

      Promise.allSettled([mediaPromise, reviewsPromise, myReviewPromise, ordersPromise]).then(
        ([mediaRes, reviewsRes, myReviewRes, ordersRes]) => {
          if (cancelledRef.current) return;

          // 1. Extra media
          if (mediaRes.status === 'fulfilled' && (mediaRes.value as any)?.data?.length > 0) {
            const mediaRows = (mediaRes.value as any).data;
            const extra = extractProductImages({ images: mediaRows }, mapped.thumbnail);
            if (extra.length > imagesList.length) {
              setProduct((prev) => prev ? { ...prev, images: extra } : null);
            }
          }

          // 2. Reviews
          if (reviewsRes.status === 'fulfilled' && Array.isArray(reviewsRes.value)) {
            const reviewsData = reviewsRes.value;
            setAllReviews(reviewsData);
            if (reviewsData.length > 0) {
              const sum = reviewsData.reduce((acc, r) => acc + r.rating, 0);
              setAvgRating(sum / reviewsData.length);
            } else {
              setAvgRating(null);
            }
          }

          // 3. User Review
          if (myReviewRes.status === 'fulfilled' && myReviewRes.value) {
            const myReviewData = myReviewRes.value;
            setMyReview(myReviewData);
            setDraftRating(myReviewData.rating);
            setDraftComment(myReviewData.comment || "");
          }

          // 4. Purchase Check
          if (ordersRes.status === 'fulfilled' && (ordersRes.value as any)?.data) {
            const userOrders = (ordersRes.value as any).data;
            const bought = userOrders.some((order: any) => {
              if (order.status && !["paid", "completed", "delivered"].includes(order.status)) {
                return false;
              }
              let itemsList: any[] = [];
              try {
                itemsList = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
              } catch (e) {
                itemsList = Array.isArray(order.items) ? order.items : [];
              }
              return Array.isArray(itemsList) && itemsList.some((item: any) => String(item.id) === String(id));
            });
            setHasPurchased(bought);
          }
        }
      );
    } catch (err) {
      console.error('[ProductDetail] load error:', err);
      if (!cancelledRef.current) {
        setIsLoading(false);
        setRefreshing(false);
      }
    }
  }, [id, user?.id]);

  useEffect(() => {
    const cancelledRef = { current: false };
    loadProduct(false, cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadProduct]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProduct(true);
  };

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!product) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground, padding: 24, fontFamily: "Inter_400Regular" }}>Product not found.</Text>
      </View>
    );
  }

  const isInCart = items.some((i) => i.product.id === product.id);
  const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  function handleAddToCart() {
    if (!product) return;
    requireAuth(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      for (let i = 0; i < localQty; i++) {
        addToCart(product);
      }
      Alert.alert("Added to Cart", `${product.title} has been added to your cart.`, [
        { text: "Continue Shopping", style: "cancel" },
        { text: "Checkout", onPress: () => router.push("/store/checkout") },
      ]);
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 120 : insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#0B6FAD']}
          />
        }
      >
        <View style={{ position: "relative" }}>
          <ImageGallery
            images={product.images && product.images.length > 0 ? product.images : [product.thumbnail]}
            height={320}
          >
            <Pressable
              style={[styles.backCircle, { top: topPad + 8 }]}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(tabs)/store");
                }
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#0B6FAD" />
            </Pressable>
            <Pressable
              style={[styles.shareCircle, { top: topPad + 8 }]}
              onPress={handleShare}
            >
              <Ionicons name="share-social" size={20} color="#0B6FAD" />
            </Pressable>
            <Pressable
              style={[styles.heartCircle, { top: topPad + 8 }]}
              onPress={handleToggleWishlist}
            >
              <Ionicons
                name={isWishlisted ? "heart" : "heart-outline"}
                size={20}
                color={isWishlisted ? "#EF4444" : "#0B6FAD"}
              />
            </Pressable>
          </ImageGallery>
          {product.badge && (
            <View style={[styles.badge, { backgroundColor: colors.secondary, bottom: 16, left: 16 }]}>
              <Text style={styles.badgeText}>{product.badge}</Text>
            </View>
          )}
        </View>

        <View style={styles.content}>
          {isOfflineCached && (
            <View style={{ backgroundColor: "#FEF3C7", padding: 10, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Ionicons name="cloud-offline" size={16} color="#D97706" />
              <Text style={{ color: "#92400E", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                Offline Mode — Showing cached product details
              </Text>
            </View>
          )}
          <Text style={[styles.subcategory, { color: colors.mutedForeground }]}>{product.subcategory}</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{product.title}</Text>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: "#0B6FAD" }]}>₹{product.price}</Text>
            <Text style={[styles.originalPrice, { color: colors.mutedForeground }]}>₹{product.originalPrice}</Text>
            <View style={[styles.discountBadge, { backgroundColor: "#DCFCE7" }]}>
              <Text style={[styles.discountText, { color: "#16A34A" }]}>{discount}% off</Text>
            </View>
          </View>

          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Ionicons
                key={i}
                name={i <= Math.round(avgRating ?? product.rating) ? "star" : "star-outline"}
                size={16}
                color={i <= Math.round(avgRating ?? product.rating) ? "#F59E0B" : "#D6E9F2"}
              />
            ))}
            <Text style={[styles.ratingText, { color: colors.mutedForeground }]}>
              {(avgRating ?? product.rating).toFixed(1)} ({allReviews.length || product.reviews} review{(allReviews.length || product.reviews) !== 1 ? "s" : ""})
            </Text>
          </View>

          {/* Stock status badge */}
          <View style={[styles.stockBadge, { backgroundColor: product.inStock ? "#DCF7F4" : "#FEE2E2" }]}>
            <Ionicons
              name={product.inStock ? "checkmark-circle" : "close-circle"}
              size={14}
              color={product.inStock ? "#17E5D3" : "#EF4444"}
            />
            <Text style={[styles.stockBadgeText, { color: product.inStock ? "#0B6FAD" : "#EF4444" }]}>
              {product.inStock ? "In Stock" : "Out of Stock"}
            </Text>
          </View>

          {/* Quantity stepper */}
          {product.inStock && (
            <View style={styles.quantityContainer}>
              <Text style={[styles.quantityLabel, { color: colors.foreground }]}>Quantity</Text>
              <View style={[styles.stepperWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => {
                    if (isInCart) {
                      decrementQuantity(product.id);
                    } else {
                      setLocalQty(prev => Math.max(1, prev - 1));
                    }
                  }}
                >
                  <Text style={styles.stepperText}>-</Text>
                </Pressable>
                <Text style={[styles.quantityVal, { color: colors.foreground }]}>
                  {isInCart ? (items.find((i) => i.product.id === product.id)?.quantity || 1) : localQty}
                </Text>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => {
                    if (isInCart) {
                      addToCart(product);
                    } else {
                      setLocalQty(prev => prev + 1);
                    }
                  }}
                >
                  <Text style={styles.stepperText}>+</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>About this product</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{product.description}</Text>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What's included</Text>
          {product.features.map((feat, idx) => (
            <View key={idx} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={16} color="#17E5D3" />
              <Text style={[styles.featureText, { color: colors.foreground }]}>{feat}</Text>
            </View>
          ))}

          {/* Average Rating Block (Muted Background) */}
          {allReviews.length > 0 && (
            <View style={[styles.avgRatingRowBlock, { backgroundColor: colors.muted, borderRadius: 14, marginTop: 16 }]}>
              <StarRating rating={Math.round(avgRating ?? 0)} size={20} readonly />
              <Text style={[styles.avgRatingText, { color: colors.foreground }]}>
                {(avgRating ?? 0).toFixed(1)}{" "}
                <Text style={{ color: colors.mutedForeground, fontWeight: "400" }}>
                  ({allReviews.length} rating{allReviews.length !== 1 ? "s" : ""})
                </Text>
              </Text>
            </View>
          )}

          {/* Rate Product Card (Only if user has purchased the product) */}
          {hasPurchased && (
            <View style={[styles.rateCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
              {/* Show current review status badge */}
              {myReview && !reviewSubmitted && (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 6,
                  paddingVertical: 6, paddingHorizontal: 12,
                  borderRadius: 20, alignSelf: "flex-start", marginBottom: 10,
                  backgroundColor:
                    myReview.status === "approved" ? "#DCFCE7" :
                    myReview.status === "rejected" ? "#FEE2E2" : "#FEF9C3",
                }}>
                  <Ionicons
                    name={myReview.status === "approved" ? "checkmark-circle" : myReview.status === "rejected" ? "close-circle" : "time"}
                    size={14}
                    color={myReview.status === "approved" ? "#16A34A" : myReview.status === "rejected" ? "#DC2626" : "#CA8A04"}
                  />
                  <Text style={{
                    fontSize: 12, fontFamily: "Inter_600SemiBold",
                    color: myReview.status === "approved" ? "#16A34A" : myReview.status === "rejected" ? "#DC2626" : "#CA8A04",
                  }}>
                    {myReview.status === "approved" ? "Review Approved" : myReview.status === "rejected" ? "Review Rejected" : "Pending Approval"}
                  </Text>
                </View>
              )}
              {reviewSubmitted ? (
                <View style={styles.thankYouRow}>
                  <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                  <Text style={[styles.thankYouText, { color: "#10B981" }]}>
                    Review submitted! It will appear after approval.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.rateTitle, { color: colors.foreground }]}>
                    {myReview ? "Edit your review" : "Rate this product"}
                  </Text>
                  <StarRating
                    rating={draftRating}
                    onRatingChange={setDraftRating}
                    size={32}
                  />
                  {draftRating > 0 && (
                    <>
                      <TextInput
                        style={[
                          styles.commentInput,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.foreground,
                          },
                        ]}
                        placeholder="Share your thoughts (optional)..."
                        placeholderTextColor={colors.mutedForeground}
                        value={draftComment}
                        onChangeText={setDraftComment}
                        multiline
                        numberOfLines={3}
                        maxLength={500}
                      />
                      <Pressable
                        style={[
                          styles.submitBtn,
                          { backgroundColor: "#0B6FAD", opacity: reviewSubmitting ? 0.6 : 1 },
                        ]}
                        onPress={handleSubmitReview}
                        disabled={reviewSubmitting}
                      >
                        {reviewSubmitting ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <Text style={styles.submitBtnText}>
                            {myReview ? "Update Review" : "Submit Review"}
                          </Text>
                        )}
                      </Pressable>
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* Review List */}
          {allReviews.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8 }]}>Reviews</Text>
              {(showAllReviews ? allReviews : allReviews.slice(0, 3)).map((review: any) => (
                <View
                  key={review.id}
                  style={[styles.reviewItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.reviewHeader}>
                    <StarRating rating={review.rating} size={14} readonly />
                    <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>
                      Verified Buyer ·{" "}
                      {new Date(review.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </View>
                  {!!review.comment && (
                    <Text style={[styles.reviewComment, { color: colors.foreground }]}>
                      "{review.comment}"
                    </Text>
                  )}
                </View>
              ))}
              {allReviews.length > 3 && (
                <Pressable
                  onPress={() => setShowAllReviews((prev) => !prev)}
                  style={styles.showAllBtn}
                >
                  <Text style={[styles.showAllText, { color: "#0B6FAD" }]}>
                    {showAllReviews ? "Show less" : `Show all ${allReviews.length} reviews →`}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* CTA Bottom Bar */}
      <View
        style={[
          styles.cta,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Platform.OS === "web" ? 20 : insets.bottom + 8,
          },
        ]}
      >
        <View style={styles.ctaRow}>
          <Pressable
            style={[styles.ghostBtn, { borderColor: "#0B6FAD", opacity: product.inStock ? 1 : 0.5 }]}
            onPress={handleAddToCart}
            disabled={!product.inStock || isInCart}
          >
            <Ionicons name="cart" size={18} color="#0B6FAD" />
            <Text style={[styles.ghostBtnText, { color: "#0B6FAD" }]}>
              {isInCart ? "In Cart" : "Add to Cart"}
            </Text>
          </Pressable>

          <Pressable
            style={{ flex: 1.2, height: 48, opacity: product.inStock ? 1 : 0.5 }}
            onPress={() => {
              requireAuth(() => {
                if (!product?.id) return;
                // Add with current local quantity before going to checkout
                const qty = localQty || 1;
                if (!isInCart) {
                  for (let i = 0; i < qty; i++) addToCart(product);
                }
                router.push("/store/checkout");
              });
            }}
            disabled={!product.inStock}
          >
            <LinearGradient
              colors={["#0B6FAD", "#17E5D3"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buyNowBtn}
            >
              <Ionicons name="flash" size={18} color="#FFF" />
              <Text style={styles.buyNowText}>Buy Now</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  imageContainer: { position: "relative", height: 280 },
  image: { width: "100%", height: "100%", resizeMode: "cover" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.2)" },
  paginationContainer: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    zIndex: 10,
  },
  paginationDot: {
    height: 8,
    borderRadius: 4,
  },
  paginationDotActive: {
    backgroundColor: "#0B6FAD",
    width: 16,
  },
  paginationDotInactive: {
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    width: 8,
  },
  backCircle: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  shareCircle: {
    position: "absolute",
    right: 68,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  heartCircle: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  badge: { position: "absolute", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 12, fontFamily: "Fredoka_700Bold", color: "#FFF" },
  content: { padding: 20, gap: 10 },
  subcategory: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 22, fontFamily: "Fredoka_700Bold", lineHeight: 28 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  price: { fontSize: 26, fontFamily: "Fredoka_700Bold" },
  originalPrice: { fontSize: 16, fontFamily: "Inter_400Regular", textDecorationLine: "line-through" },
  discountBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  discountText: { fontSize: 12, fontFamily: "Fredoka_700Bold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { fontSize: 13, fontFamily: "Inter_400Regular", marginLeft: 4 },
  sectionTitle: { fontSize: 17, fontFamily: "Fredoka_700Bold", marginTop: 4 },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  cta: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: 1 },
  stockBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  stockBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  stepperWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 12,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
    color: "#0B6FAD",
  },
  quantityVal: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  quantityContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 8,
  },
  quantityLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ghostBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: "#FFFFFF",
  },
  ghostBtnText: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
  },
  buyNowBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 48,
    borderRadius: 24,
  },
  buyNowText: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  avgRatingRowBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avgRatingText: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  rateCard: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
  },
  rateTitle: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  submitBtnText: {
    fontSize: 15,
    fontFamily: "Fredoka_700Bold",
    color: "#FFF",
  },
  thankYouRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  thankYouText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  reviewItem: {
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewMeta: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  reviewComment: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
  },
  showAllBtn: {
    paddingVertical: 8,
    alignItems: "center",
  },
  showAllText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});

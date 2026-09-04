import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
  Share,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProductCard } from "@/components/ProductCard";
import { SearchBar } from "@/components/SearchBar";
import { SectionHeader } from "@/components/SectionHeader";
import { ProductCardSkeleton } from "@/components/SkeletonLoader";
import { useCart } from "@/context/CartContext";
import { Product } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import { storeRepository } from "@/repositories/storeRepository";
import { useAuth } from "@/context/AuthContext";
import { useNetwork } from "@/context/NetworkContext";
import { useTabSwipe } from "@/hooks/useTabSwipe";

export default function StoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { panHandlers, SwipeIndicator } = useTabSwipe("/(tabs)/store");
  const { count } = useCart();
  const { isOffline } = useAuth();
  const { addReconnectListener } = useNetwork();

  // Debounce ref — prevents rapid reconnect events from triggering repeated refreshes
  const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnce = useRef(false);

  const handleShare = async () => {
    try {
      await Share.share({
        title: "MakersFlow Store",
        message: `Check out the MakersFlow Store!\n\nOpen in app: makersflow://store\n\nDownload MakersFlow: https://play.google.com/store/apps/details?id=com.makersflow.app`,
      });
    } catch (error) {
      console.error("[StoreShare] Share failed error:", error);
    }
  };
  const params = useLocalSearchParams<{ category?: string }>();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(params.category || "All");

  useEffect(() => {
    if (params.category) {
      setActiveCategory(params.category);
    }
  }, [params.category]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadProducts = useCallback(async (isRefreshing = false) => {
    if (!isRefreshing && !hasLoadedOnce.current) setIsLoading(true);
    try {
      const result = await storeRepository.get(isOffline, isRefreshing);
      setProducts(result.data.products);
      hasLoadedOnce.current = true;
    } catch (err) {
      console.error('[Store] loadProducts error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isOffline]);

  // ── Reconnect listener with debounce (prevents rapid refresh storms) ──────
  useEffect(() => {
    const unsubscribe = addReconnectListener(() => {
      if (reconnectDebounceRef.current) clearTimeout(reconnectDebounceRef.current);
      reconnectDebounceRef.current = setTimeout(() => {
        loadProducts(true);
      }, 1500);
    });
    return () => {
      unsubscribe();
      if (reconnectDebounceRef.current) clearTimeout(reconnectDebounceRef.current);
    };
  }, [addReconnectListener, loadProducts]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) {
        loadProducts(false); // first load only — cached after that
      }
      // No refetch on tab switch — use pull-to-refresh for fresh data
    }, [loadProducts])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProducts(true);
    setRefreshing(false);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const physicalProducts = products.filter((p) => p.category === "physical");
  const digitalProducts = products.filter((p) => p.category === "digital");

  const storeCategories = [
    "All",
    ...Array.from(new Set(products.map((p) => p.subcategory).filter(Boolean))),
  ];

  const filtered = products.filter((p) => {
    const matchSearch = p.title.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "All" || p.subcategory === activeCategory;
    return matchSearch && matchCat;
  });

  const handleAddedToCart = useCallback(() => {
    if (Platform.OS === "web") {
      Alert.alert("Added to cart", "Item has been added to your cart");
    }
  }, []);

  const handleCartPress = () => {
    router.push("/cart");
  };

  const handleClearSearch = () => {
    setSearch("");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panHandlers}>
      <SwipeIndicator />
      <View style={[styles.topBar, { paddingTop: topPad + 12 }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Store</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={[styles.whiteSquareBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleShare}
            >
              <Ionicons name="share-social" size={20} color="#0B6FAD" />
            </Pressable>
            <Pressable
              style={[styles.whiteSquareBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleCartPress}
            >
              <Ionicons name="cart" size={20} color="#0B6FAD" />
              {count > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{count}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search products..." />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          {storeCategories.map((cat) => (
            <Pressable
              key={cat}
              style={[
                styles.chip,
                {
                  backgroundColor: activeCategory === cat ? colors.primary : colors.card,
                  borderColor: activeCategory === cat ? "transparent" : colors.border,
                },
              ]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.chipText, { color: activeCategory === cat ? "#FFF" : colors.mutedForeground }]}>{cat}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0B6FAD']} />
        }
      >
        {isLoading ? (
          <>
            <View style={styles.section}>
              <SectionHeader title="Physical Kits" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carouselContent}
              >
                <ProductCardSkeleton width={160} />
                <ProductCardSkeleton width={160} />
                <ProductCardSkeleton width={160} />
              </ScrollView>
            </View>
            <View style={styles.section}>
              <SectionHeader title="Digital Resources" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carouselContent}
              >
                <ProductCardSkeleton width={160} />
                <ProductCardSkeleton width={160} />
                <ProductCardSkeleton width={160} />
              </ScrollView>
            </View>
          </>
        ) : products.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
              <Ionicons name="cart" size={40} color={colors.accentForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No products available</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Check back later for new kits and resources!
            </Text>
          </View>
        ) : search || activeCategory !== "All" ? (
          filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                <Ionicons name="search" size={40} color={colors.accentForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No products found</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Try adjusting your search or filters
              </Text>
              {search && (
                <Pressable
                  style={[styles.clearBtn, { backgroundColor: "#0B6FAD" }]}
                  onPress={handleClearSearch}
                >
                  <Text style={styles.clearBtnText}>Clear Search</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={[styles.count, { color: colors.mutedForeground }]}>{filtered.length} products found</Text>
              <View style={styles.gridContainer}>
                {filtered.map((p) => (
                  <View key={p.id} style={styles.gridItem}>
                    <ProductCard product={p} onAddedToCart={handleAddedToCart} gridMode variant="flat" />
                  </View>
                ))}
              </View>
            </View>
          )
        ) : (
          <>
            {physicalProducts.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Physical Kits" />
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.carouselContent}
                >
                  {physicalProducts.map((p) => <ProductCard key={p.id} product={p} onAddedToCart={handleAddedToCart} variant="flat" />)}
                </ScrollView>
              </View>
            )}
            {digitalProducts.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Digital Resources" />
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.carouselContent}
                >
                  {digitalProducts.map((p) => <ProductCard key={p.id} product={p} onAddedToCart={handleAddedToCart} variant="flat" />)}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Cart FAB bottom-right */}
      {count > 0 && (
        <Pressable
          style={[styles.cartFab, { bottom: insets.bottom + 80 }]}
          onPress={handleCartPress}
        >
          <Ionicons name="cart" size={24} color="#FFF" />
          <View style={styles.cartFabBadge}>
            <Text style={styles.cartFabBadgeText}>{count}</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { paddingBottom: 12 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  pageTitle: { fontSize: 26, fontFamily: "Fredoka_700Bold" },
  whiteSquareBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
  },
  cartBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#17E5D3",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  cartBadgeText: { fontSize: 10, fontFamily: "Fredoka_700Bold", color: "#063B4F" },
  categories: { paddingHorizontal: 20, gap: 8, paddingTop: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  section: { paddingTop: 20, marginBottom: 24 },
  count: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12, paddingHorizontal: 20 },
  carouselContent: { paddingLeft: 20, paddingRight: 20 },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    justifyContent: "space-between",
  },
  gridItem: {
    width: "48%",
    marginBottom: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Fredoka_700Bold",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  clearBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  cartFab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0B6FAD",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cartFabBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#17E5D3",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  cartFabBadgeText: {
    fontSize: 10,
    fontFamily: "Fredoka_700Bold",
    color: "#063B4F",
  },
});

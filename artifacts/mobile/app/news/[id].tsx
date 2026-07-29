import { Feather, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, Stack } from "expo-router";
import React, { useState, useEffect } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchNewsById, type NewsArticle } from "@/services/newsService";
import { useColors } from "@/hooks/useColors";
import { TEXT_STYLES } from "@/constants/typography";

export default function NewsDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<NewsArticle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadArticle() {
      if (!id) return;
      try {
        const article = await fetchNewsById(id);
        setItem(article);
      } catch (err) {
        console.error('[NewsDetailScreen] Error loading article:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadArticle();
  }, [id]);

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 12, fontSize: 14, color: colors.mutedForeground, fontWeight: "500" }}>Loading...</Text>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground, padding: 24 }}>Article not found.</Text>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        title: item.title,
        message: `Check out "${item.title}" on MakersFlow!\n\nOpen in app: makersflow://news/${id}\n\nDownload MakersFlow: https://play.google.com/store/apps/details?id=com.makersflow.app`,
      });
    } catch (error) {
      console.error("[NewsDetail] Error sharing article:", error);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const imageSource = typeof item.thumbnail === "string" ? { uri: item.thumbnail } : item.thumbnail;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
      >
        <View style={styles.imageContainer}>
          <Image source={imageSource} style={styles.image} />
          <View style={styles.overlay} />
          <Pressable
            style={[styles.backCircle, { top: topPad + 8 }]}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/news");
              }
            }}
          >
            <Feather name="arrow-left" size={20} color="#FFF" />
          </Pressable>
        </View>

        <View style={styles.content}>
          <View style={[styles.categoryBadge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.categoryText, TEXT_STYLES.label, { color: colors.primary }]}>{item.category}</Text>
          </View>
          <Text style={[styles.title, TEXT_STYLES.pageTitle, { color: colors.foreground, fontSize: 22, lineHeight: 30 }]}>
            {item.title}
          </Text>

          <View style={styles.metaRow}>
            <Ionicons name="person" size={13} color={colors.mutedForeground} />
            <Text style={[styles.meta, TEXT_STYLES.meta, { color: colors.mutedForeground }]}>{item.author}</Text>
            <Text style={[styles.metaDot, { color: colors.border }]}>·</Text>
            <Ionicons name="calendar" size={13} color={colors.mutedForeground} />
            <Text style={[styles.meta, TEXT_STYLES.meta, { color: colors.mutedForeground }]}>{item.date}</Text>
            <Text style={[styles.metaDot, { color: colors.border }]}>·</Text>
            <Ionicons name="time" size={13} color={colors.mutedForeground} />
            <Text style={[styles.meta, TEXT_STYLES.meta, { color: colors.mutedForeground }]}>{item.readTime}</Text>
          </View>

          {/* Render summaryBox ONLY IF summary is a distinct excerpt, not a duplicate prefix of content */}
          {item.summary && !item.content.trim().startsWith(item.summary.replace("...", "").trim()) ? (
            <View style={[styles.summaryBox, { backgroundColor: colors.accent, borderLeftColor: colors.primary }]}>
              <Text style={[styles.summaryText, TEXT_STYLES.description, { color: colors.primary, fontWeight: "600" }]}>
                {item.summary}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.body, TEXT_STYLES.description, { color: colors.foreground, fontSize: 15, lineHeight: 24 }]}>
            {item.content}
          </Text>

          <View style={styles.tags}>
            {item.tags.map((tag) => (
              <View key={tag} style={[styles.tag, { backgroundColor: colors.muted }]}>
                <Text style={[styles.tagText, TEXT_STYLES.meta, { color: colors.mutedForeground }]}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Floating Share FAB */}
      <Pressable
        style={({ pressed }) => [
          styles.shareFab,
          { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1, bottom: insets.bottom + 16 }
        ]}
        onPress={handleShare}
      >
        <Ionicons name="share-social" size={22} color="#FFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  imageContainer: { position: "relative", height: 260 },
  image: { width: "100%", height: "100%", resizeMode: "cover" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.3)" },
  backCircle: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 20, gap: 12 },
  categoryBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  categoryText: { fontSize: 12, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "800", lineHeight: 30 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  meta: { fontSize: 12 },
  metaDot: { fontSize: 12, marginHorizontal: 2 },
  summaryBox: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 10, borderRadius: 4 },
  summaryText: { fontSize: 15, fontWeight: "600", lineHeight: 22 },
  body: { fontSize: 15, lineHeight: 26 },
  tags: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tagText: { fontSize: 12 },
  shareFab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
});

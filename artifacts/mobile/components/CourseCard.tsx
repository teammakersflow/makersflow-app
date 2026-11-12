import { coursePriceLabel } from "@/lib/courseAccess";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View, ToastAndroid, Platform, Alert } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Course } from "@/data/mockData";
import { getOptimizedImageUrl } from "@/lib/thumbnailUtils";
import { useColors } from "@/hooks/useColors";
import { useProgress } from "@/context/ProgressContext";
import { useFavorites } from "@/context/FavoritesContext";
import { FavoriteButton } from "./FavoriteButton";

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;
// 48 = 20px left padding + 8px gap + 20px right padding

interface CourseCardProps {
  course: Course & { images?: string[] };
  horizontal?: boolean;
  compact?: boolean;
}

export const CourseCard = React.memo(function CourseCard({ course, horizontal = false, compact = false }: CourseCardProps) {
  const colors = useColors();
  const { getCourseProgress } = useProgress();
  const { isFavoriteCourse, toggleFavoriteCourse } = useFavorites();
  const courseProgress = getCourseProgress(course.id);
  const isEnrolled = !!courseProgress;
  const progress = courseProgress?.progress || 0;
  const isFavorite = isFavoriteCourse(course.id);
  const [activeIndex, setActiveIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(compact ? 170 : CARD_WIDTH);
  const courseImages = course.images && Array.isArray(course.images) && course.images.length > 0
    ? course.images
    : null;

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert('', message);
    }
  };

  const handleFavoritePress = (e?: any) => {
    if (e?.stopPropagation) {
      e.stopPropagation();
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasAdded = !isFavorite;
    toggleFavoriteCourse({
      id: course.id,
      title: course.title,
      thumbnail: course.thumbnail,
      category: course.category,
      price: course.price,
      isFree: course.isFree,
    });
    showToast(wasAdded ? 'Added to Favorites' : 'Removed from Favorites');
  };

  const renderStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    
    for (let i = 1; i <= 5; i++) {
      if (i <= fullStars) {
        stars.push(<MaterialIcons key={i} name="star" size={11} color="#F59E0B" />);
      } else if (i === fullStars + 1 && hasHalfStar) {
        stars.push(<MaterialIcons key={i} name="star-half" size={11} color="#F59E0B" />);
      } else {
        stars.push(<MaterialIcons key={i} name="star-outline" size={11} color="#E5E7EB" />);
      }
    }
    return stars;
  };

  const getBadgeInfo = () => {
    if (course.isFree) return { text: "Free", color: "#16A34A" };
    if (course.isBestseller) return { text: "Bestseller", color: "#F59E0B" };
    return null;
  };

  const badge = getBadgeInfo();

  if (horizontal) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.horizontalCard,
          { opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => router.push({ pathname: "/course/[id]", params: { id: course.id } })}
      >
        <View style={styles.horizontalThumbnailContainer}>
          <Image source={getOptimizedImageUrl(course.thumbnail, { width: 300, height: 200 })} cachePolicy="memory-disk" style={styles.horizontalThumbnail} contentFit="cover" transition={200} />
          {badge && (
            <View style={[styles.badge, { backgroundColor: badge.color }]}>
              <Text style={styles.badgeText}>{badge.text}</Text>
            </View>
          )}
        </View>
        <View style={styles.horizontalContent}>
          <View style={[styles.categoryPill, { backgroundColor: colors.accent }]}>
            <Text style={[styles.categoryText, { color: colors.primary }]}>{course.category}</Text>
          </View>
          <View style={styles.titleRow}>
            <Text style={[styles.horizontalTitle, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>
              {course.title}
            </Text>
            <FavoriteButton
              isFavorite={isFavorite}
              onPress={handleFavoritePress}
              size={16}
            />
          </View>
          <Text style={[styles.instructor, { color: colors.mutedForeground }]}>{course.instructor}</Text>
          <View style={styles.ratingRow}>
            <View style={styles.starsContainer}>
              {renderStars(course.rating)}
            </View>
            <Text style={[styles.ratingNumber, { color: colors.mutedForeground }]}>{course.rating}</Text>
            <Text style={[styles.reviewCount, { color: colors.mutedForeground }]}>({course.reviews})</Text>
          </View>
          {isEnrolled && progress > 0 ? (
            <View style={styles.horizontalProgressContainer}>
              <View style={[styles.thinProgressTrack, { backgroundColor: colors.muted }]}>
                <View
                  style={[
                    styles.thinProgressFill,
                    { width: `${progress}%` as any, backgroundColor: colors.primary },
                  ]}
                />
              </View>
              <Text style={[styles.progressPercentage, { color: colors.mutedForeground }]}>{progress}%</Text>
            </View>
          ) : (
            <Text style={[styles.priceTextLarge, { color: colors.foreground }]}>
              {coursePriceLabel(course)}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [
        compact ? styles.compactCard : styles.card,
        { opacity: pressed ? 0.7 : 1 },
      ]}
      onPress={() => router.push({ pathname: "/course/[id]", params: { id: course.id } })}
    >
      <View style={styles.thumbnailContainer} onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
        {courseImages ? (
          <View style={{ flex: 1 }}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / (containerWidth || (compact ? 170 : CARD_WIDTH)));
                setActiveIndex(index);
              }}
              style={{ width: containerWidth || (compact ? 170 : CARD_WIDTH), height: compact ? 85 : 110 }}
              contentContainerStyle={{ height: compact ? 85 : 110 }}
            >
              {courseImages.map((item: any, index: number) => {
                const src = typeof item === "string" ? { uri: item } : item;
                return (
                  <Image
                    key={`img_${index}`}
                    source={getOptimizedImageUrl(src, { width: 400, height: 260 })}
                    cachePolicy="memory-disk"
                    style={{
                      width: containerWidth || (compact ? 170 : CARD_WIDTH),
                      height: compact ? 85 : 110,
                    }}
                    contentFit="cover"
                    transition={200}
                  />
                );
              })}
            </ScrollView>
            {courseImages.length > 1 && (
              <View style={styles.paginationDots}>
                {courseImages.map((_: any, i: number) => (
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
          <Image source={getOptimizedImageUrl(course.thumbnail, { width: 400, height: 260 })} cachePolicy="memory-disk" style={compact ? styles.compactThumbnail : styles.thumbnail} contentFit="cover" transition={200} />
        )}
        {badge && (
          <View style={[styles.badge, { backgroundColor: badge.color }]}>
            <Text style={styles.badgeText}>{badge.text}</Text>
          </View>
        )}
      </View>
      <View style={styles.cardContent}>
        <View style={[styles.categoryPill, { backgroundColor: colors.accent }]}>
          <Text style={[styles.categoryText, { color: colors.primary }]}>{course.category}</Text>
        </View>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>
            {course.title}
          </Text>
          <FavoriteButton
            isFavorite={isFavorite}
            onPress={handleFavoritePress}
            size={14}
          />
        </View>
        <Text style={[styles.instructor, { color: colors.mutedForeground }]}>{course.instructor}</Text>
        <View style={styles.ratingRow}>
          <View style={styles.starsContainer}>
            {renderStars(course.rating)}
          </View>
          <Text style={[styles.ratingNumber, { color: colors.mutedForeground }]}>{course.rating}</Text>
          <Text style={[styles.reviewCount, { color: colors.mutedForeground }]}>({course.reviews})</Text>
        </View>
        {isEnrolled && progress > 0 ? (
          <View style={styles.progressContainerBottom}>
            <View style={[styles.thinProgressTrack, { backgroundColor: colors.muted }]}>
              <View
                style={[
                  styles.thinProgressFill,
                  { width: `${progress}%` as any, backgroundColor: colors.primary },
                ]}
              />
            </View>
            <Text style={[styles.progressPercentage, { color: colors.mutedForeground }]}>{progress}%</Text>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <Text style={[styles.priceTextLarge, { color: colors.foreground }]}>
              {coursePriceLabel(course)}
            </Text>
            <Pressable
              style={[styles.addBtn, { backgroundColor: colors.secondary }]}
              onPress={() => router.push({ pathname: "/course/[id]", params: { id: course.id } })}
            >
              <Feather name="plus" size={13} color="#FFF" />
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // Vertical card - borderless modern style
  card: {
    width: CARD_WIDTH,
    marginRight: 16,
  },
  compactCard: {
    width: 170,
    marginRight: 12,
  },
  thumbnailContainer: {
    position: "relative",
    borderRadius: 8,
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: 110,
  },
  compactThumbnail: {
    width: "100%",
    height: 85,
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "700",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  cardContent: {
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
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
  title: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  instructor: {
    fontSize: 11,
    marginTop: -2,
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
  ratingNumber: {
    fontSize: 11,
    fontWeight: "700",
  },
  reviewCount: {
    fontSize: 10,
  },
  priceTextLarge: {
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
    flex: 1,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 6,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  progressContainerBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  thinProgressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
  },
  thinProgressFill: {
    height: 3,
    borderRadius: 1.5,
  },
  progressPercentage: {
    fontSize: 10,
    fontWeight: "600",
  },
  // Horizontal card - borderless modern style
  horizontalCard: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 12,
  },
  horizontalThumbnailContainer: {
    position: "relative",
    borderRadius: 8,
    overflow: "hidden",
  },
  horizontalThumbnail: {
    width: 120,
    height: 90,
  },
  horizontalContent: {
    flex: 1,
    gap: 4,
  },
  horizontalTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  horizontalProgressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
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
});

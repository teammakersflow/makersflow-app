import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  FavoriteCourse,
  WatchLaterLesson,
  FavoritesStorage,
} from "@/lib/favoritesStorage";
import { wishlistService } from "@/services/wishlistService";

interface FavoritesContextType {
  favoriteCourses: FavoriteCourse[];
  watchLaterLessons: WatchLaterLesson[];
  downloadedLessons: WatchLaterLesson[];
  wishlistProductIds: string[];
  isFavoriteCourse: (courseId: string) => boolean;
  isInWatchLater: (lessonId: string) => boolean;
  isProductInWishlist: (productId: string) => boolean;
  toggleFavoriteCourse: (course: {
    id: string;
    title: string;
    thumbnail: any;
    category: string;
    price: number;
    isFree: boolean;
  }) => Promise<void>;
  toggleWatchLater: (lesson: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    courseTitle: string;
    lessonTitle: string;
    courseThumbnail: any;
  }) => Promise<void>;
  addDownloadedLesson: (lesson: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    courseTitle: string;
    lessonTitle: string;
    courseThumbnail: any;
  }) => Promise<void>;
  removeFavoriteCourse: (courseId: string) => Promise<void>;
  removeFromWatchLater: (lessonId: string) => Promise<void>;
  removeDownloadedLesson: (lessonId: string) => Promise<void>;
  toggleWishlistProduct: (productId: string) => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextType | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  // Use session to get the userId - session is available immediately after restore
  // whereas `user` (the profile) requires an extra async getProfile() call
  const { user, session } = useAuth();
  const [favoriteCourses, setFavoriteCourses] = useState<FavoriteCourse[]>([]);
  const [watchLaterLessons, setWatchLaterLessons] = useState<WatchLaterLesson[]>([]);
  const [downloadedLessons, setDownloadedLessons] = useState<WatchLaterLesson[]>([]);
  const [wishlistProductIds, setWishlistProductIds] = useState<string[]>([]);

  // The reliable user ID: prefer profile user.id, fall back to session user id
  const userId = user?.id ?? (session as any)?.user?.id ?? null;

  // Track previous userId to detect logout
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (userId) {
      if (prevUserIdRef.current !== userId) {
        prevUserIdRef.current = userId;
        loadAllFavorites(userId);
      }
    } else {
      prevUserIdRef.current = null;
      setFavoriteCourses([]);
      setWatchLaterLessons([]);
      setDownloadedLessons([]);
      setWishlistProductIds([]);
    }
  }, [userId]);

  async function loadAllFavorites(uid: string) {
    try {
      const [courses, lessons, downloads] = await Promise.all([
        FavoritesStorage.loadFavoriteCourses(uid),
        FavoritesStorage.loadWatchLater(uid),
        FavoritesStorage.loadDownloadedLessons(uid),
      ]);
      setFavoriteCourses(courses);
      setWatchLaterLessons(lessons);
      setDownloadedLessons(downloads);

      // Load product wishlist via canonical backend service
      const wishlistIds = await wishlistService.getWishlist(uid);
      setWishlistProductIds(wishlistIds);
    } catch (error) {
      console.error("Failed to load favorites:", error);
    }
  }

  function isFavoriteCourse(courseId: string): boolean {
    return favoriteCourses.some((c) => c.courseId === courseId);
  }

  function isInWatchLater(lessonId: string): boolean {
    return watchLaterLessons.some((l) => l.lessonId === lessonId);
  }

  async function toggleFavoriteCourse(course: {
    id: string;
    title: string;
    thumbnail: any;
    category: string;
    price: number;
    isFree: boolean;
  }): Promise<void> {
    // Always update in-memory state immediately for instant UI feedback
    const existingIndex = favoriteCourses.findIndex(
      (c) => c.courseId === course.id
    );

    let updatedCourses: FavoriteCourse[];

    if (existingIndex >= 0) {
      updatedCourses = favoriteCourses.filter(
        (c) => c.courseId !== course.id
      );
    } else {
      // Normalize thumbnail: if it's a URI object, extract the string
      const thumbnailValue =
        course.thumbnail && typeof course.thumbnail === "object" && course.thumbnail.uri
          ? course.thumbnail.uri
          : course.thumbnail;

      const newFavorite: FavoriteCourse = {
        courseId: course.id,
        courseTitle: course.title,
        courseThumbnail: thumbnailValue,
        category: course.category,
        price: course.price,
        isFree: course.isFree,
        savedAt: new Date().toISOString(),
      };
      updatedCourses = [newFavorite, ...favoriteCourses];
    }

    setFavoriteCourses(updatedCourses);

    // Persist to AsyncStorage if we have a userId
    if (userId) {
      await FavoritesStorage.saveFavoriteCourses(userId, updatedCourses);
    } else {
      console.warn("[Favorites] No userId available — favorite saved in memory only");
    }
  }

  async function toggleWatchLater(lesson: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    courseTitle: string;
    lessonTitle: string;
    courseThumbnail: any;
  }): Promise<void> {
    const existingIndex = watchLaterLessons.findIndex(
      (l) => l.lessonId === lesson.lessonId
    );

    let updatedLessons: WatchLaterLesson[];

    if (existingIndex >= 0) {
      updatedLessons = watchLaterLessons.filter(
        (l) => l.lessonId !== lesson.lessonId
      );
    } else {
      const thumbnailValue =
        lesson.courseThumbnail && typeof lesson.courseThumbnail === "object" && lesson.courseThumbnail.uri
          ? lesson.courseThumbnail.uri
          : lesson.courseThumbnail;

      const newLesson: WatchLaterLesson = {
        courseId: lesson.courseId,
        moduleId: lesson.moduleId,
        lessonId: lesson.lessonId,
        courseTitle: lesson.courseTitle,
        lessonTitle: lesson.lessonTitle,
        courseThumbnail: thumbnailValue,
        savedAt: new Date().toISOString(),
      };
      updatedLessons = [newLesson, ...watchLaterLessons];
    }

    setWatchLaterLessons(updatedLessons);

    if (userId) {
      await FavoritesStorage.saveWatchLater(userId, updatedLessons);
    } else {
      console.warn("[Favorites] No userId available — watch later saved in memory only");
    }
  }

  async function addDownloadedLesson(lesson: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    courseTitle: string;
    lessonTitle: string;
    courseThumbnail: any;
  }): Promise<void> {
    const existingIndex = downloadedLessons.findIndex(
      (l) => l.lessonId === lesson.lessonId
    );

    if (existingIndex >= 0) return; // Already downloaded

    const thumbnailValue =
      lesson.courseThumbnail && typeof lesson.courseThumbnail === "object" && lesson.courseThumbnail.uri
        ? lesson.courseThumbnail.uri
        : lesson.courseThumbnail;

    const newLesson: WatchLaterLesson = {
      courseId: lesson.courseId,
      moduleId: lesson.moduleId,
      lessonId: lesson.lessonId,
      courseTitle: lesson.courseTitle,
      lessonTitle: lesson.lessonTitle,
      courseThumbnail: thumbnailValue,
      savedAt: new Date().toISOString(),
    };
    const updatedLessons = [newLesson, ...downloadedLessons];
    setDownloadedLessons(updatedLessons);

    if (userId) {
      await FavoritesStorage.saveDownloadedLessons(userId, updatedLessons);
    }
  }

  async function removeFavoriteCourse(courseId: string): Promise<void> {
    const updatedCourses = favoriteCourses.filter(
      (c) => c.courseId !== courseId
    );
    setFavoriteCourses(updatedCourses);
    if (userId) {
      await FavoritesStorage.saveFavoriteCourses(userId, updatedCourses);
    }
  }

  async function removeFromWatchLater(lessonId: string): Promise<void> {
    const updatedLessons = watchLaterLessons.filter(
      (l) => l.lessonId !== lessonId
    );
    setWatchLaterLessons(updatedLessons);
    if (userId) {
      await FavoritesStorage.saveWatchLater(userId, updatedLessons);
    }
  }

  async function removeDownloadedLesson(lessonId: string): Promise<void> {
    const updatedLessons = downloadedLessons.filter(
      (l) => l.lessonId !== lessonId
    );
    setDownloadedLessons(updatedLessons);
    if (userId) {
      await FavoritesStorage.saveDownloadedLessons(userId, updatedLessons);
    }
  }

  function isProductInWishlist(productId: string): boolean {
    return wishlistProductIds.includes(String(productId));
  }

  async function toggleWishlistProduct(productId: string): Promise<void> {
    if (!userId) return;
    const isWishlisted = isProductInWishlist(productId);
    const prevIds = wishlistProductIds;
    
    // Optimistic UI update with safe rollback on failure
    if (isWishlisted) {
      setWishlistProductIds((prev) => prev.filter((id) => id !== String(productId)));
      try {
        await wishlistService.removeFromWishlist(productId, userId);
      } catch (err) {
        console.error("Failed to delete from wishlist:", err);
        setWishlistProductIds(prevIds);
        throw err;
      }
    } else {
      setWishlistProductIds((prev) => [...prev, String(productId)]);
      try {
        await wishlistService.addToWishlist(productId, userId);
      } catch (err) {
        console.error("Failed to insert into wishlist:", err);
        setWishlistProductIds(prevIds);
        throw err;
      }
    }
  }

  return (
    <FavoritesContext.Provider
      value={{
        favoriteCourses,
        watchLaterLessons,
        downloadedLessons,
        wishlistProductIds,
        isFavoriteCourse,
        isInWatchLater,
        isProductInWishlist,
        toggleFavoriteCourse,
        toggleWatchLater,
        addDownloadedLesson,
        removeFavoriteCourse,
        removeFromWatchLater,
        removeDownloadedLesson,
        toggleWishlistProduct,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}

import { Feather } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  Modal,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import Slider from "@react-native-community/slider";
const SliderComponent = Slider as any;
import { useColors } from "@/hooks/useColors";
import { SPACING } from "@/constants/spacing";
import { PlaybackSpeedSelector } from "./PlaybackSpeedSelector";
import { router } from "expo-router";

const devLog = (...args: any[]) => {
  if (__DEV__) console.log(...args);
};
const devError = (...args: any[]) => {
  if (__DEV__) console.error(...args);
};

interface VideoPlayerProps {
  videoUrl: string;
  initialTime?: number;
  onProgressUpdate?: (currentTime: number, duration: number) => void;
  onComplete?: () => void;
  onLoadingStateChange?: (isLoading: boolean) => void;
  onRefreshVideoUrl?: () => Promise<string | null>;
}

export function VideoPlayerEnhanced({
  videoUrl,
  initialTime = 0,
  onProgressUpdate,
  onComplete,
  onLoadingStateChange,
  onRefreshVideoUrl,
}: VideoPlayerProps) {
  const colors = useColors();
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [lastStatus, setLastStatus] = useState<string>("");
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  // Buffering watchdog: if the player sits in "loading" beyond this window,
  // show a weak-connection prompt instead of an infinite spinner (PDF §8)
  const STALL_TIMEOUT_MS = 15000;
  const [isStalled, setIsStalled] = useState(false);
  const loadingSince = useRef<number | null>(null);

  const retryCountRef = useRef(0);
  const lastStatusRef = useRef("");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentVideoUrlRef = useRef(videoUrl);
  const refreshVideoUrlRef = useRef(onRefreshVideoUrl);
  const isReplacingSourceRef = useRef(false);

  useEffect(() => {
    refreshVideoUrlRef.current = onRefreshVideoUrl;
  }, [onRefreshVideoUrl]);

  const replaceVideoSource = async (): Promise<boolean> => {
    if (isReplacingSourceRef.current) return false;
    isReplacingSourceRef.current = true;

    try {
      let source = currentVideoUrlRef.current;

      if (refreshVideoUrlRef.current) {
        const freshUrl = await refreshVideoUrlRef.current();
        if (!freshUrl) {
          throw new Error("Could not obtain a fresh signed video URL");
        }
        source = freshUrl;
      }

      if (!isMounted.current || !player) return false;

      currentVideoUrlRef.current = source;
      player.replace(source);
      loadingSince.current = null;
      setIsStalled(false);
      setHasError(false);
      setIsRetrying(true);
      return true;
    } catch (error) {
      devError("[VideoPlayer] Source refresh/retry failed:", error);
      if (isMounted.current) {
        setHasError(true);
        setIsRetrying(false);
      }
      return false;
    } finally {
      isReplacingSourceRef.current = false;
    }
  };

  const handleVideoError = () => {
    if (retryTimerRef.current) return;

    if (retryCountRef.current >= 3) {
      setHasError(true);
      setIsRetrying(false);
      return;
    }

    const nextRetry = retryCountRef.current + 1;
    retryCountRef.current = nextRetry;
    setRetryCount(nextRetry);
    setIsRetrying(true);

    const delay = nextRetry === 1 ? 0 : nextRetry === 2 ? 3000 : 10000;

    devLog(`[VideoPlayer] Scheduling retry ${nextRetry}/3 in ${delay}ms`);

    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (isMounted.current) {
        devLog(`[VideoPlayer] Executing retry ${nextRetry}/3`);
        void replaceVideoSource();
      }
    }, delay);
  };

  const [isMuted, setIsMuted] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showVolumeBar, setShowVolumeBar] = useState(false);
  const [volume, setVolume] = useState(1.0);

  const handleVolumeChange = (val: number) => {
    if (!player) return;
    player.volume = val;
    setVolume(val);
    if (val > 0 && player.muted) {
      player.muted = false;
      setIsMuted(false);
    }
  };
  const barHeight = useRef(new Animated.Value(3)).current;
  const barWidth = useRef(0);

  const toggleMute = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!player) return;
    player.muted = !player.muted;
    setIsMuted(player.muted);
  };

  const handleTouch = (event: any) => {
    if (!duration || duration <= 0 || !isFinite(duration)) return;
    const locationX = event.nativeEvent.locationX;
    const width = barWidth.current || 1;
    const ratio = Math.max(0, Math.min(1, locationX / width));
    const newTime = ratio * duration;
    if (isFinite(newTime)) {
      player.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleTouchStart = (event: any) => {
    setIsScrubbing(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    Animated.timing(barHeight, {
      toValue: 5,
      duration: 150,
      useNativeDriver: false,
    }).start();
    handleTouch(event);
  };

  const handleTouchMove = (event: any) => {
    handleTouch(event);
  };

  const handleTouchEnd = async () => {
    setIsScrubbing(false);
    Animated.timing(barHeight, {
      toValue: 3,
      duration: 150,
      useNativeDriver: false,
    }).start();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showControlsWithTimer();
  };

  // FIX: Dynamic dimensions that update on orientation change
  const [screenDims, setScreenDims] = useState(Dimensions.get("window"));

  const isMounted = useRef(true);
  const hasEmittedComplete = useRef(false);
  const lastSaveTime = useRef(0);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoContainerRef = useRef<any>(null);

  const player = useVideoPlayer(videoUrl, (player) => {
    player.loop = false;
    player.muted = false;
    // Only restore if meaningful progress (>30s to avoid demo artifacts)
    if (initialTime > 30) {
      player.currentTime = initialTime;
    }
  });

  // Keep track of mounted state
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  // Pause player explicitly on unmount / when player instance changes
  useEffect(() => {
    return () => {
      try {
        if (player) {
          player.pause();
        }
      } catch (err) {
        devLog("[VideoPlayer] Cleanup pause ignored:", err);
      }
    };
  }, [player]);

  // FIX: Listen for dimension changes (fires when device rotates)
  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      if (isMounted.current) {
        setScreenDims(window);
      }
    });
    return () => subscription.remove();
  }, []);

  // FIX: Lock to portrait on mount, unlock on unmount
  useEffect(() => {
    if (Platform.OS !== "web") {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
    }
    return () => {
      if (Platform.OS !== "web") {
        ScreenOrientation.unlockAsync().catch(() => {});
      }
    };
  }, []);

  // When videoUrl changes (lesson switch), replace the source and reset
  // completion flag so the new lesson can fire onComplete (Bug 4 & 5).
  const prevVideoUrl = useRef(videoUrl);
  useEffect(() => {
    if (!player) return;

    if (videoUrl !== prevVideoUrl.current) {
      prevVideoUrl.current = videoUrl;
      currentVideoUrlRef.current = videoUrl;
      hasEmittedComplete.current = false;
      lastSaveTime.current = 0;
      lastStatusRef.current = "";
      retryCountRef.current = 0;

      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      setRetryCount(0);
      setHasError(false);
      setIsRetrying(false);
      loadingSince.current = null;
      setIsStalled(false);

      try {
        player.replace(videoUrl);
        if (initialTime > 30) {
          setTimeout(() => {
            try {
              if (isMounted.current) player.currentTime = initialTime;
            } catch {}
          }, 300);
        }
      } catch (err) {
        devLog('[VideoPlayer] replace error:', err);
      }
    }

    devLog("[VideoPlayer] URL:", videoUrl, "initialTime:", initialTime);
  }, [videoUrl, player]);

  // Auto-hide controls after delay when playing
  // Use a ref for isPlaying so showControlsWithTimer always reads the
  // current value without needing to be recreated (Bug 2).
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const showControlsWithTimer = useCallback(() => {
    if (!isMounted.current) return;
    setShowControls(true);
    Animated.timing(overlayOpacity, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();

    if (hideTimer.current) clearTimeout(hideTimer.current);

    hideTimer.current = setTimeout(() => {
      if (!isMounted.current) return;
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 350, // Slowly vanish over 350ms
        useNativeDriver: true,
      }).start(() => {
        if (isMounted.current) setShowControls(false);
      });
    }, 2500); // 2.5 sec delay
  }, []);

  // Stable refs for callbacks so the polling interval never needs to be
  // recreated when the parent re-renders (Bug 3).
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const onCompleteRef = useRef(onComplete);
  const onLoadingStateChangeRef = useRef(onLoadingStateChange);
  useEffect(() => { onProgressUpdateRef.current = onProgressUpdate; }, [onProgressUpdate]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onLoadingStateChangeRef.current = onLoadingStateChange; }, [onLoadingStateChange]);

  useEffect(() => {
    if (!player) return;

    const playingInterval = setInterval(() => {
      try {
        if (!isMounted.current || !player) {
          clearInterval(playingInterval);
          return;
        }

        const playing = player.playing;
        const currentT = player.currentTime;
        const durationT = player.duration;
        const status = player.status;

        // Only update isPlaying state if it actually changed to avoid
        // unnecessary re-renders fighting with togglePlayPause
        if (playing !== isPlayingRef.current) {
          isPlayingRef.current = playing;
          setIsPlaying(playing);
        }
        setCurrentTime(currentT);
        setDuration(durationT);
        setIsMuted(player.muted);
        setVolume(player.volume);

        const loading = status === "loading";
        setIsLoading(loading);
        onLoadingStateChangeRef.current?.(loading);

        // Buffering watchdog — stuck in "loading" for too long
        if (loading) {
          if (loadingSince.current === null) loadingSince.current = Date.now();
          else if (Date.now() - loadingSince.current > STALL_TIMEOUT_MS) setIsStalled(true);
        } else {
          loadingSince.current = null;
          setIsStalled(false);
        }

        if (status !== lastStatusRef.current) {
          lastStatusRef.current = status;

          if (status === "readyToPlay") {
            devLog(
              "[VideoPlayer] Video ready - Status:",
              status,
              "Duration:",
              durationT
            );
            retryCountRef.current = 0;
            setRetryCount(0);
            setHasError(false);
            setIsRetrying(false);
          }

          if (status === "error") {
            devError("[VideoPlayer] Video error detected");
            handleVideoError();
          }

          setLastStatus(status);
        }

        // Save progress every 5 seconds
        const now = Date.now();
        if (playing && now - lastSaveTime.current >= 5000) {
          onProgressUpdateRef.current?.(currentT, durationT);
          lastSaveTime.current = now;
        }

        // Check completion threshold (90%)
        const percentage = durationT > 0 ? (currentT / durationT) * 100 : 0;
        if (percentage >= 90 && !hasEmittedComplete.current) {
          onCompleteRef.current?.();
          hasEmittedComplete.current = true;
        }
      } catch (err) {
        devLog("[VideoPlayer] Player accessed after release / during unmount, ignoring:", err);
        clearInterval(playingInterval);
      }
    }, 100);

    return () => {
      clearInterval(playingInterval);
    };
  }, [player]); // stable — only recreate when player instance changes

  // Auto-hide effect
  useEffect(() => {
    showControlsWithTimer();
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, []);

  // Listen for fullscreen changes (web platform)
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const handleFullscreenChange = () => {
      if (!isMounted.current) return;
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      );
      if (isCurrentlyFullscreen !== isFullscreen) {
        setIsFullscreen(isCurrentlyFullscreen);
        devLog(
          "[VideoPlayer] Fullscreen state changed:",
          isCurrentlyFullscreen
        );
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener(
      "webkitfullscreenchange",
      handleFullscreenChange
    );

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange
      );
    };
  }, [isFullscreen]);

  const handleBackPress = () => {
    if (isFullscreen) {
      toggleFullscreen();
    } else {
      router.back();
    }
  };

  // Single tap only toggles controls visibility.
  // Play/pause is handled exclusively by the explicit buttons (Bug 1).
  const handleVideoTap = () => {
    if (!showControls) {
      showControlsWithTimer();
    } else {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }).start(() => {
        if (isMounted.current) setShowControls(false);
      });
    }
  };

  const [showLeftIndicator, setShowLeftIndicator] = useState(false);
  const [showRightIndicator, setShowRightIndicator] = useState(false);
  const leftIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const singleTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoWidth = useRef(0);

  const handleVideoPress = async (event: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    const locationX = event.nativeEvent.locationX;
    const containerW = videoWidth.current || screenDims.width;
    const isLeft = locationX < containerW / 2;

    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      // Double tap detected!
      if (singleTapTimeout.current) {
        clearTimeout(singleTapTimeout.current);
        singleTapTimeout.current = null;
      }

      if (isLeft) {
        // Seek backward 10s
        player.seekBy(-10);
        setCurrentTime(Math.max(0, currentTime - 10));
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        // Show indicator
        setShowLeftIndicator(true);
        if (leftIndicatorTimeout.current) clearTimeout(leftIndicatorTimeout.current);
        leftIndicatorTimeout.current = setTimeout(() => {
          setShowLeftIndicator(false);
        }, 800);
      } else {
        // Seek forward 10s
        if (duration > 0) {
          player.seekBy(10);
          setCurrentTime(Math.min(duration, currentTime + 10));
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

          // Show indicator
          setShowRightIndicator(true);
          if (rightIndicatorTimeout.current) clearTimeout(rightIndicatorTimeout.current);
          rightIndicatorTimeout.current = setTimeout(() => {
            setShowRightIndicator(false);
          }, 800);
        }
      }
    } else {
      // Schedule single tap action
      singleTapTimeout.current = setTimeout(() => {
        handleVideoTap();
        singleTapTimeout.current = null;
      }, DOUBLE_TAP_DELAY);
    }
    lastTap.current = now;
  };

  const togglePlayPause = async () => {
    if (singleTapTimeout.current) {
      clearTimeout(singleTapTimeout.current);
      singleTapTimeout.current = null;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isMounted.current || !player) return;

    try {
      // Read ground truth from player directly — never from stale React state
      const currentlyPlaying = player.playing;
      const isAtEnd = duration > 0 && player.currentTime >= duration - 0.5;

      if (currentlyPlaying) {
        player.pause();
        setIsPlaying(false);
        isPlayingRef.current = false;
      } else {
        if (isAtEnd) {
          player.currentTime = 0;
          hasEmittedComplete.current = false;
        }
        player.play();
        setIsPlaying(true);
        isPlayingRef.current = true;
      }
      showControlsWithTimer();
    } catch (err) {
      devError("[VideoPlayer] Failed togglePlayPause:", err);
    }
  };

  const skipForward = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isMounted.current || !player) return;
    if (!duration || duration <= 0 || !isFinite(duration)) return;

    try {
      player.seekBy(10);
      setCurrentTime(Math.min(duration, currentTime + 10));
      showControlsWithTimer();
    } catch (err) {
      devError("[VideoPlayer] Failed skipForward:", err);
    }
  };

  const skipBackward = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isMounted.current || !player) return;

    try {
      player.seekBy(-10);
      setCurrentTime(Math.max(0, currentTime - 10));
      showControlsWithTimer();
    } catch (err) {
      devError("[VideoPlayer] Failed skipBackward:", err);
    }
  };

  const handleSpeedChange = async (speed: number) => {
    if (!isMounted.current || !player) return;
    try {
      player.playbackRate = speed;
      setPlaybackSpeed(speed);
      showControlsWithTimer();
      devLog("[VideoPlayer] Playback speed changed to:", speed);
    } catch (error) {
      devError("[VideoPlayer] Failed to change playback speed:", error);
    }
  };

  const handleSliderChange = (value: number) => {
    if (!isMounted.current || !player) return;
    if (!duration || duration <= 0 || !isFinite(duration)) {
      devLog("[VideoPlayer] Cannot seek - invalid duration:", duration);
      return;
    }

    try {
      const newTime = value;
      if (isFinite(newTime) && newTime >= 0) {
        player.currentTime = newTime;
      } else {
        devLog("[VideoPlayer] Invalid seek time calculated:", newTime);
      }
    } catch (err) {
      devError("[VideoPlayer] Failed handleSliderChange:", err);
    }
  };

  const handleSliderStart = () => {
    // Show controls when starting to drag
    showControlsWithTimer();
  };

  const handleSliderComplete = async () => {
    // Haptic feedback when done dragging
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showControlsWithTimer();
  };

  const toggleFullscreen = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (Platform.OS === "web") {
        if (!isFullscreen) {
          const element = videoContainerRef.current as any;
          if (element?.requestFullscreen) {
            await element.requestFullscreen();
            setIsFullscreen(true);
          } else if (element?.webkitRequestFullscreen) {
            await element.webkitRequestFullscreen();
            setIsFullscreen(true);
          }
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
            setIsFullscreen(false);
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
            setIsFullscreen(false);
          }
        }
      } else {
        // FIX: Show modal FIRST then rotate when entering,
        //      rotate back FIRST then hide modal when exiting
        if (!isFullscreen) {
          setIsFullscreen(true);
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.LANDSCAPE
          );
          devLog("[VideoPlayer] Entered fullscreen - landscape mode");
        } else {
          await ScreenOrientation.unlockAsync();
          setIsFullscreen(false);
          devLog("[VideoPlayer] Exited fullscreen - orientation unlocked");
        }
      }
    } catch (error) {
      devError("[VideoPlayer] Fullscreen toggle failed:", error);
      setIsFullscreen(!isFullscreen);
    }
    showControlsWithTimer();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  const renderVideoControls = () => (
    <>
      {/* Loading Overlay */}
      {isLoading && !isStalled && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContainer, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.foreground, marginTop: 8 }]}>
              Please wait...
            </Text>
          </View>
        </View>
      )}

      {/* Weak-connection prompt after prolonged buffering */}
      {isLoading && isStalled && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.errorContainer, { backgroundColor: colors.card }]}>
            <Feather name="wifi-off" size={32} color="#F59E0B" />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Slow or unstable connection. Check your internet and try again.
            </Text>
            <View style={styles.errorBtnRow}>
              <Pressable
                style={[styles.errorBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = null;
                  }
                  retryCountRef.current = 0;
                  setRetryCount(0);
                  void replaceVideoSource();
                }}
              >
                <Text style={styles.errorBtnText}>Reconnect</Text>
              </Pressable>
              <Pressable
                style={[styles.errorBtn, { backgroundColor: colors.muted }]}
                onPress={handleBackPress}
              >
                <Text style={[styles.errorBtnText, { color: colors.foreground }]}>Go Back</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {isRetrying && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContainer, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.foreground, marginTop: 8 }]}>
              Retrying... ({retryCount}/3)
            </Text>
          </View>
        </View>
      )}

      {hasError && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.errorContainer, { backgroundColor: colors.card }]}>
            <Feather name="alert-circle" size={32} color="#DC2626" />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Unable to load video. Please check your connection.
            </Text>
            <View style={styles.errorBtnRow}>
              <Pressable
                style={[styles.errorBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = null;
                  }
                  retryCountRef.current = 0;
                  setRetryCount(0);
                  void replaceVideoSource();
                }}
              >
                <Text style={styles.errorBtnText}>Try Again</Text>
              </Pressable>
              <Pressable
                style={[styles.errorBtn, { backgroundColor: colors.muted }]}
                onPress={handleBackPress}
              >
                <Text style={[styles.errorBtnText, { color: colors.foreground }]}>Go Back</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Controls Overlay */}
      <Animated.View
        style={[styles.controlsOverlay, { opacity: overlayOpacity }]}
        pointerEvents={showControls || isScrubbing ? "box-none" : "none"}
      >
        {/* Top Bar */}
        <View style={styles.topBar} pointerEvents="auto">
          {isFullscreen && (
            <Pressable
              onPress={handleBackPress}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Feather name="arrow-left" size={24} color="#FFF" />
            </Pressable>
          )}
        </View>

        {/* Center Controls (Large Play/Pause Button + Skip Buttons) */}
        <View style={styles.centerPlayOverlayContainer}>
          {showControls && (
            <View style={styles.centerPlaybackButtons}>
              <Pressable onPress={skipBackward} style={styles.centerPlayPauseBtn}>
                <Feather name="rotate-ccw" size={22} color="#FFF" />
                <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "bold", marginTop: 2 }}>10s</Text>
              </Pressable>

              <Pressable onPress={togglePlayPause} style={[styles.centerPlayPauseBtn, { width: 70, height: 70, borderRadius: 35 }]}>
                <Feather name={isPlaying ? "pause" : "play"} size={36} color="#FFF" style={isPlaying ? {} : { marginLeft: 4 }} />
              </Pressable>

              <Pressable onPress={skipForward} style={styles.centerPlayPauseBtn}>
                <Feather name="rotate-cw" size={22} color="#FFF" />
                <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "bold", marginTop: 2 }}>10s</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Bottom Player Area */}
        <View style={styles.bottomWrapper} pointerEvents="auto">
          {/* Controls Bar */}
          <View style={styles.bottomControlBar}>
            {/* Progress Slider (Matching volume bar slider style) */}
            <SliderComponent
              style={styles.progressSlider}
              value={currentTime}
              minimumValue={0}
              maximumValue={duration || 1}
              minimumTrackTintColor="#FF0000" // Played portion: YouTube Red
              maximumTrackTintColor="rgba(255, 255, 255, 0.3)" // Unplayed track
              thumbTintColor="#FFFFFF" // Scrubber dot: white
              onValueChange={handleSliderChange}
              onSlidingStart={handleSliderStart}
              onSlidingComplete={handleSliderComplete}
            />

            <View style={styles.controlsRow}>
              {/* Left: Play/Pause Button + Volume Control + Time display */}
              <View style={styles.leftControls}>
                <Pressable onPress={togglePlayPause} style={styles.controlBtn}>
                  <Feather name={isPlaying ? "pause" : "play"} size={22} color="#FFF" />
                </Pressable>

                <Pressable onPress={() => setShowVolumeBar(!showVolumeBar)} style={styles.controlBtn}>
                  <Feather name={isMuted || volume === 0 ? "volume-x" : volume < 0.5 ? "volume-1" : "volume-2"} size={20} color="#FFF" />
                </Pressable>

                {showVolumeBar && (
                  <SliderComponent
                    style={styles.volumeSlider}
                    value={isMuted ? 0 : volume}
                    minimumValue={0}
                    maximumValue={1}
                    minimumTrackTintColor="#FFFFFF"
                    maximumTrackTintColor="rgba(255,255,255,0.3)"
                    thumbTintColor="#FFFFFF"
                    onValueChange={handleVolumeChange}
                  />
                )}

                <Text style={[styles.timeText, { marginLeft: 4 }]}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </Text>
              </View>

              {/* Right: Settings Icon + Fullscreen Button */}
              <View style={styles.rightControls}>
                <PlaybackSpeedSelector
                  currentSpeed={playbackSpeed}
                  onSpeedChange={handleSpeedChange}
                  asIcon={true}
                />

                <Pressable onPress={toggleFullscreen} style={styles.controlBtn}>
                  <Feather name={isFullscreen ? "minimize-2" : "maximize-2"} size={20} color="#FFF" />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Animated.View>
    </>
  );

  return (
    <>
      {/* Normal View */}
      <View style={styles.container}>
        <Pressable
          ref={videoContainerRef}
          style={styles.videoContainer}
          onLayout={(e) => { videoWidth.current = e.nativeEvent.layout.width; }}
          onPress={handleVideoPress}
        >
          <VideoView
            player={player}
            style={styles.video}
            nativeControls={false}
            contentFit="cover"
            allowsPictureInPicture={false}
          />
          <View style={StyleSheet.absoluteFill} />
          
          {/* Double Tap Seek Indicators */}
          {showLeftIndicator && (
            <View style={styles.leftSeekIndicator}>
              <View style={styles.indicatorCircle}>
                <Text style={styles.indicatorText}>⏪</Text>
                <Text style={styles.indicatorSubtext}>10s</Text>
              </View>
            </View>
          )}

          {showRightIndicator && (
            <View style={styles.rightSeekIndicator}>
              <View style={styles.indicatorCircle}>
                <Text style={styles.indicatorText}>⏩</Text>
                <Text style={styles.indicatorSubtext}>10s</Text>
              </View>
            </View>
          )}

          {renderVideoControls()}
        </Pressable>
      </View>

      {/* Fullscreen Modal (Native only) */}
      {Platform.OS !== "web" && (
        <Modal
          visible={isFullscreen}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={toggleFullscreen}
          supportedOrientations={[
            "landscape",
            "landscape-left",
            "landscape-right",
            "portrait",
          ]}
        >
          <StatusBar hidden={true} translucent={true} />
          <View style={styles.fullscreenContainer}>
            <Pressable
              style={styles.fullscreenVideoContainer}
              onLayout={(e) => { videoWidth.current = e.nativeEvent.layout.width; }}
              onPress={handleVideoPress}
            >
              <VideoView
                player={player}
                style={styles.fullscreenVideo}
                nativeControls={false}
                contentFit="cover"
                allowsPictureInPicture={false}
              />
              <View style={StyleSheet.absoluteFill} />
              
              {/* Double Tap Seek Indicators */}
              {showLeftIndicator && (
                <View style={styles.leftSeekIndicator}>
                  <View style={styles.indicatorCircle}>
                    <Text style={styles.indicatorText}>⏪</Text>
                    <Text style={styles.indicatorSubtext}>10s</Text>
                  </View>
                </View>
              )}

              {showRightIndicator && (
                <View style={styles.rightSeekIndicator}>
                  <View style={styles.indicatorCircle}>
                    <Text style={styles.indicatorText}>⏩</Text>
                    <Text style={styles.indicatorSubtext}>10s</Text>
                  </View>
                </View>
              )}

              {renderVideoControls()}
            </Pressable>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    position: "relative",
    overflow: "visible",
  },
  videoContainer: {
    flex: 1,
    position: "relative",
    overflow: "visible",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  // FIX: flex-based sizing instead of hardcoded Dimensions px values
  fullscreenVideoContainer: {
    flex: 1,
    width: "100%",
    height: "100%",
    position: "relative",
  },
  fullscreenVideo: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  loadingContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600",
  },
  errorContainer: {
    padding: 24,
    borderRadius: 20,
    alignItems: "center",
    width: "85%",
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
  },
  errorBtnRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  errorBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBtnText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.15)",
    justifyContent: "space-between",
  },
  centerPlayOverlayContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  centerPlayPauseBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(0, 0, 0, 0.5)", // Dark semi-transparent circle
    justifyContent: "center",
    alignItems: "center",
  },
  leftSeekIndicator: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "50%",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 4,
  },
  rightSeekIndicator: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: "50%",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 4,
  },
  indicatorCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  indicatorText: {
    color: "#FFF",
    fontSize: 28,
    fontWeight: "bold",
  },
  indicatorSubtext: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  topBar: {
    padding: 12,
    alignItems: "flex-start",
  },
  bottomWrapper: {
    width: "100%",
    position: "relative",
  },
  bottomControlBar: {
    backgroundColor: "transparent",
    paddingTop: 4,
    paddingBottom: Platform.OS === "ios" ? 18 : 8, // Safe area padding back here
    width: "100%",
  },
  progressSlider: {
    width: "100%",
    height: 30,
    marginTop: -8,
    marginBottom: -4,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#FF0000', // YouTube Red
  },
  scrubberDot: {
    position: 'absolute',
    top: -3.5, // Centers vertically on the animated track
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    zIndex: 100,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  leftControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  volumeSlider: {
    width: 70,
    height: 30,
    marginLeft: 4,
  },
  rightControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  volumeBtn: {
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  timeText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "500",
  },
  centerPlaybackButtons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  controlBtn: {
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  playPauseBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  rightPlaceholder: {
    flex: 1,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
});

import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/auth/apiClient";
import { TEXT_STYLES } from "@/constants/typography";

export default function QuizScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id: lessonId, title } = useLocalSearchParams<{ id: string; title?: string }>();

  const [questions, setQuestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [timeLeft, setTimeLeft] = useState(600);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  // Refs mirror state so the timer interval always sees the latest values
  // without needing to be torn down and recreated on every answer.
  const answersRef = useRef<number[]>([]);
  const selectedRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { selectedRef.current = selectedOption; }, [selectedOption]);

  useEffect(() => {
    async function loadQuiz() {
      if (!lessonId || isNaN(Number(lessonId))) {
        setIsLoading(false);
        setQuestions([]);
        return;
      }
      setIsLoading(true);
      try {
        const res = await apiRequest<any>(`/quiz-questions/lesson/${lessonId}`);
        const list = res?.data ?? (Array.isArray(res) ? res : null);
        if (Array.isArray(list) && list.length > 0) {
          const mapped = list.map((q: any) => {
            let opts = [];
            try {
              opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
            } catch {
              opts = Array.isArray(q.options) ? q.options : [];
            }
            return {
              id: q.id,
              question: q.question_text,
              options: opts,
              correctIndex: q.correct_option_index !== undefined ? Number(q.correct_option_index) : undefined,
              explanation: "Select the correct answer to complete this question.",
            };
          });
          setQuestions(mapped);
          setTimeLeft(mapped.length * 60 || 600);
        } else {
          setQuestions([]);
        }
      } catch (err: any) {
        console.error('[Quiz] load error:', err);
        setQuestions([]);
      } finally {
        setIsLoading(false);
      }
    }
    loadQuiz();
  }, [lessonId]);

  useEffect(() => {
    if (isLoading || questions.length === 0) return;
    // BUG FIX: the old effect depended on `answers`, so the interval was torn
    // down and recreated after every question — causing timer drift. It also
    // dropped the currently-selected (not yet submitted) answer on timeout.
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          // Defer navigation out of the state updater; include the answer the
          // user selected but hadn't pressed "Next" on yet.
          setTimeout(() => {
            const final = [...answersRef.current];
            if (final.length < questions.length) final.push(selectedRef.current ?? -1);
            finishQuiz(final);
          }, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLoading, questions.length]);

  // NEW FEATURE: confirm before exiting a quiz in progress.
  const confirmExit = useCallback(() => {
    Alert.alert(
      "Exit Quiz?",
      "Do you really want to exit? Your progress in this quiz will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Exit",
          style: "destructive",
          onPress: () => {
            finishedRef.current = true;
            if (timerRef.current) clearInterval(timerRef.current);
            router.back();
          },
        },
      ],
    );
  }, []);

  // Android hardware back must also go through the confirmation.
  useEffect(() => {
    if (isLoading || questions.length === 0) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmExit();
      return true;
    });
    return () => sub.remove();
  }, [isLoading, questions.length, confirmExit]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 12, fontSize: 14, color: colors.mutedForeground, fontWeight: "500" }}>Loading...</Text>
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad + 40, alignItems: "center", paddingHorizontal: 32 }]}>
        <View style={[styles.emptyIconContainer, { backgroundColor: colors.muted }]}>
          <Feather name="help-circle" size={48} color={colors.mutedForeground} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Quiz Coming Soon
        </Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          There are no quiz questions added for this lesson yet. Check back later!
        </Text>
        <Pressable
          style={[styles.backBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const question = questions[currentIndex];
  const progress = (currentIndex / questions.length) * 100;
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  async function selectOption(idx: number) {
    if (selectedOption !== null) return;
    setSelectedOption(idx);

    let isCorrect = false;
    let correctIdx = question.correctIndex;

    if (correctIdx !== undefined) {
      isCorrect = idx === correctIdx;
    } else {
      try {
        const { data, error } = await (supabase as any).rpc("check_quiz_answer", {
          p_question_id: question.id,
          p_selected_index: idx,
        });
        if (!error && data && data.length > 0) {
          isCorrect = !!data[0].is_correct;
          correctIdx = Number(data[0].correct_option_index);
          question.correctIndex = correctIdx;
          setQuestions([...questions]);
        }
      } catch (e) {
        console.warn("[Quiz] check_quiz_answer error:", e);
      }
    }

    if (isCorrect) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    }
  }

  function next() {
    const newAnswers = [...answers, selectedOption ?? -1];
    if (currentIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setCurrentIndex(currentIndex + 1);
      setSelectedOption(null);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      finishQuiz(newAnswers);
    }
  }

  function finishQuiz(finalAnswers: number[]) {
    if (finishedRef.current) return; // prevent double navigation (timeout + Finish tap)
    finishedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    const score = finalAnswers.reduce((s, ans, i) => (questions[i]?.correctIndex !== undefined && ans === questions[i].correctIndex ? s + 1 : s), 0);
    router.replace({
      pathname: "/quiz/result",
      params: { 
        quizId: lessonId, 
        score: score.toString(), 
        total: questions.length.toString(),
        title: title ?? "Quiz"
      },
    });
  }

  const optionColors = (idx: number) => {
    if (selectedOption === null) {
      return { bg: colors.card, border: colors.border, text: colors.foreground };
    }
    if (question.correctIndex !== undefined && idx === question.correctIndex) {
      return { bg: "#DCF7F4", border: "#17E5D3", text: "#063B4F" };
    }
    if (idx === selectedOption) {
      return { bg: "#FEE2E2", border: "#EF4444", text: "#7F1D1D" };
    }
    return { bg: colors.card, border: colors.border, text: colors.mutedForeground };
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={confirmExit}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <View style={[styles.counterPill, { backgroundColor: colors.accent }]}>
          <Text style={[styles.counterPillText, TEXT_STYLES.label, { color: colors.primary }]}>
            {currentIndex + 1} of {questions.length}
          </Text>
        </View>
        <View style={[styles.timer, { backgroundColor: timeLeft < 60 ? "#FEE2E2" : colors.accent }]}>
          <Ionicons name="time" size={12} color={timeLeft < 60 ? "#DC2626" : colors.primary} />
          <Text style={[styles.timerText, TEXT_STYLES.label, { color: timeLeft < 60 ? "#DC2626" : colors.primary, fontSize: 13 }]}>
            {mins}:{secs.toString().padStart(2, "0")}
          </Text>
        </View>
      </View>

      {/* Progress */}
      <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
        <Animated.View style={[styles.progressFill, { width: `${progress}%` as any, backgroundColor: colors.primary }]} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
          <Text style={[styles.questionNum, TEXT_STYLES.label, { color: colors.mutedForeground }]}>Question {currentIndex + 1}</Text>
          <Text style={[styles.question, TEXT_STYLES.sectionTitle, { color: colors.foreground, fontSize: 20, lineHeight: 28 }]}>{question.question}</Text>

          <View style={styles.options}>
            {question.options.map((opt: string, idx: number) => {
              const oc = optionColors(idx);
              return (
                <Pressable
                  key={idx}
                  style={[styles.option, { backgroundColor: oc.bg, borderColor: oc.border }]}
                  onPress={() => selectOption(idx)}
                  disabled={selectedOption !== null}
                >
                  <View style={[styles.optionLetter, { backgroundColor: oc.border }]}>
                    <Text style={[styles.optionLetterText, TEXT_STYLES.label, { color: "#FFF" }]}>
                      {["A", "B", "C", "D"][idx]}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, TEXT_STYLES.description, { color: oc.text, flex: 1 }]}>{opt}</Text>
                  {selectedOption !== null && question.correctIndex !== undefined && idx === question.correctIndex && (
                    <Ionicons name="checkmark-circle" size={20} color="#17E5D3" />
                  )}
                  {selectedOption === idx && question.correctIndex !== undefined && idx !== question.correctIndex && (
                    <Ionicons name="close-circle" size={20} color="#EF4444" />
                  )}
                </Pressable>
              );
            })}
          </View>

          {selectedOption !== null && (
            <View style={[styles.explanationBox, { backgroundColor: colors.accent }]}>
              <Ionicons name="information-circle" size={16} color={colors.primary} style={{ marginRight: 4 }} />
              <Text style={[styles.explanationText, TEXT_STYLES.description, { color: colors.primary, flex: 1, fontSize: 13 }]}>
                {question.explanation}
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Next button */}
      {selectedOption !== null && (
        <View
          style={[
            styles.bottomBtn,
            { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Platform.OS === "web" ? 20 : insets.bottom + 8 },
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.nextBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            onPress={next}
          >
            <View style={styles.btnContent}>
              <Ionicons name="arrow-forward" size={16} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={[styles.nextBtnText, TEXT_STYLES.button, { color: "#FFF" }]}>
                {currentIndex === questions.length - 1 ? "Finish Quiz" : "Next Question"}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#FFF" style={{ marginLeft: 6 }} />
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  counterPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  counterPillText: {
    fontSize: 13,
    fontWeight: "700",
  },
  timer: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  timerText: { fontSize: 13, fontWeight: "600" },
  progressTrack: { height: 4 },
  progressFill: { height: 4 },
  content: { padding: 20 },
  questionNum: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  question: { fontSize: 20, fontWeight: "700", lineHeight: 28, marginBottom: 24 },
  options: { gap: 12 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
  },
  optionLetter: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  optionLetterText: { fontSize: 13, fontWeight: "700" },
  optionText: { fontSize: 15, lineHeight: 20 },
  explanationBox: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginTop: 16,
    alignItems: "flex-start",
  },
  explanationText: { fontSize: 13, lineHeight: 18 },
  bottomBtn: { padding: 16, borderTopWidth: 1 },
  nextBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtnText: { fontSize: 15, fontWeight: "700", color: "#FFF" },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 15,
  },
});

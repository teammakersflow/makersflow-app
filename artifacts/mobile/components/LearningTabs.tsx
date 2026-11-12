import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Module } from "@/data/mockData";
import { QUIZZES } from "@/data/mockData";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";

interface LearningTabsProps {
  module: Module;
}

type TabType = "overview" | "quiz" | "resources" | "notes";

export function LearningTabs({ module }: LearningTabsProps) {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [inQuiz, setInQuiz] = useState(false);
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const courseQuiz = QUIZZES.find(q => q.courseId === courseId);

  const handleTabPress = async (tab: TabType) => {
    if (inQuiz && tab !== "quiz") {
      Alert.alert(
        "Exit Quiz?",
        "Are you sure you want to leave? Your progress will be lost.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Exit",
            style: "destructive",
            onPress: () => {
              setInQuiz(false);
              setActiveTab(tab);
              Haptics.selectionAsync();
            },
          },
        ]
      );
      return;
    }
    await Haptics.selectionAsync();
    setActiveTab(tab);
  };

  const handleResourcePress = async (resource: any) => {
    // L-18: only open https resource links (no intent:, file:, javascript:, http: etc.).
    if (resource?.url && /^https:\/\/[^\s]+$/i.test(String(resource.url))) {
      try {
        await Linking.openURL(String(resource.url));
      } catch {
        Alert.alert("Could not open", "This resource link appears to be invalid.");
      }
    } else {
      Alert.alert("Coming Soon", "This resource will be downloadable soon.");
    }
  };

  return (
    <View style={styles.container}>
      {/* Tab Headers */}
      <View style={[styles.tabHeaders, { borderBottomColor: colors.border }]}>
        {[
          { key: "overview", label: "Overview", icon: "book-open" },
          { key: "quiz", label: "Quiz", icon: "help-circle" },
          { key: "resources", label: "Resources", icon: "download" },
          { key: "notes", label: "Notes", icon: "edit-3" },
        ].map((tab) => (
          <Pressable
            key={tab.key}
            style={[
              styles.tabHeader,
              activeTab === tab.key && {
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
            onPress={() => handleTabPress(tab.key as TabType)}
          >
            <Feather
              name={tab.icon as any}
              size={16}
              color={activeTab === tab.key ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.tabHeaderText,
                {
                  color: activeTab === tab.key ? colors.primary : colors.mutedForeground,
                  fontWeight: activeTab === tab.key ? "600" : "500",
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab Content */}
      <ScrollView
        style={styles.tabContent}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {activeTab === "overview" && (
          <View style={styles.overviewContent}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              About this lesson
            </Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              {module.description}
            </Text>
          </View>
        )}

        {activeTab === "quiz" && (
          <View style={styles.quizContent}>
            <View style={styles.quizIntro}>
              <View style={[styles.quizIconContainer, { backgroundColor: colors.accent }]}>
                <Feather name="award" size={48} color={colors.primary} />
              </View>
              <Text style={[styles.quizTitle, { color: colors.foreground }]}>
                Lesson Quiz
              </Text>
              <Text style={[styles.quizDescription, { color: colors.mutedForeground }]}>
                Test your knowledge of "{module.title}"
              </Text>
              <Pressable
                style={[styles.startQuizBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push({ pathname: "/quiz/[id]", params: { id: module.id, title: module.title } });
                }}
              >
                <Text style={styles.startQuizBtnText}>Start Quiz</Text>
                <Feather name="arrow-right" size={18} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}

        {activeTab === "resources" && (
          <View style={styles.resourcesContent}>
            {module.resources.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="folder" size={48} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No resources yet
                </Text>
                <Text style={[styles.emptyDescription, { color: colors.mutedForeground }]}>
                  Resources for this lesson will appear here when available
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Downloadable Resources
                </Text>
                {module.resources.map((resource) => (
                  <Pressable
                    key={resource.id}
                    style={[styles.resourceItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleResourcePress(resource)}
                  >
                    <View style={[styles.resourceIcon, { backgroundColor: colors.accent }]}>
                      <Feather
                        name={resource.type === "pdf" ? "file-text" : resource.type === "zip" ? "archive" : "file"}
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    
                    <View style={styles.resourceInfo}>
                      <Text style={[styles.resourceTitle, { color: colors.foreground }]} numberOfLines={1}>
                        {resource.title}
                      </Text>
                      <Text style={[styles.resourceMeta, { color: colors.mutedForeground }]}>
                        {(resource.type ?? 'file').toUpperCase()}{resource.size ? ` · ${resource.size}` : ''}
                      </Text>
                    </View>

                    <Feather name="download" size={20} color={colors.primary} />
                  </Pressable>
                ))}
              </>
            )}
          </View>
        )}

        {activeTab === "notes" && (
          <View style={styles.notesContent}>
            {module.notes.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="edit-3" size={48} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No notes yet
                </Text>
                <Text style={[styles.emptyDescription, { color: colors.mutedForeground }]}>
                  Key learning points will appear here as you progress
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Key Learning Points
                </Text>
                {module.notes.map((note, index) => (
                  <View key={index} style={[styles.noteItem, { backgroundColor: colors.accent }]}>
                    <View style={[styles.noteBullet, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.noteText, { color: colors.foreground }]}>
                      {note}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabHeaders: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tabHeader: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabHeaderText: {
    fontSize: 13,
  },
  tabContent: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  
  // Overview Tab
  overviewContent: {
    gap: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
  },

  // Resources Tab
  resourcesContent: {
    gap: 12,
  },
  resourceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  resourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  resourceInfo: {
    flex: 1,
  },
  resourceTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  resourceMeta: {
    fontSize: 12,
  },

  // Notes Tab
  notesContent: {
    gap: 12,
  },
  noteItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  noteBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    flexShrink: 0,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },

  // Empty States
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  emptyDescription: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },

  // Quiz Styles
  quizContent: {
    padding: 16,
  },
  quizIntro: {
    alignItems: "center",
    paddingVertical: 20,
  },
  quizIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  quizTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  quizDescription: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  quizMeta: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 24,
  },
  quizMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quizMetaText: {
    fontSize: 13,
  },
  startQuizBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    gap: 8,
  },
  startQuizBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
  quizInProgress: {
    padding: 20,
    alignItems: "center",
  },
  quizInProgressText: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 22,
  },
  exitQuizBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  exitQuizBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
import { Feather, Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { TEXT_STYLES } from '@/constants/typography';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { WebView, WebViewProps } from 'react-native-webview';

const RNWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<any> }
>;

const TRANSPARENT_1X1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function generateCertId(studentName: string, courseName: string, dateStr: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  const year = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  let hash = 0;
  const str = `${studentName}:${courseName}:${dateStr}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash).toString(16).padStart(6, '0').toUpperCase().slice(0, 6);
  return `MF-CERT-${year}-${positiveHash}`;
}

function getCertificateHtml(
  studentName: string,
  courseName: string,
  daysCompleted: string,
  displayDate: string,
  certId: string,
  flowLogoBase64: string,
  edodwajaLogoBase64: string,
  badgeBase64: string,
  level?: string,
  instructor?: string
) {
  const daysText =
    daysCompleted && daysCompleted !== 'N/A' && daysCompleted !== 'undefined'
      ? `${daysCompleted} days`
      : 'all required modules';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Certificate of Completion</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }
        html, body {
          width: 100%;
          height: 100%;
          background: #0f172a;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        .cert-wrapper {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 12px;
        }
        .certificate {
          width: 100%;
          max-width: 960px;
          aspect-ratio: 297 / 210;
          background: linear-gradient(135deg, #e0f7fa 0%, #ffffff 45%, #e0f2fe 100%);
          padding: 4% 5%;
          position: relative;
          overflow: hidden;
          border-radius: 12px;
          border: 3px solid #00bcd4;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          text-align: center;
        }
        .certificate::before {
          content: "";
          position: absolute;
          top: -100px;
          right: -100px;
          width: 320px;
          height: 320px;
          background: radial-gradient(circle, rgba(0, 188, 212, 0.25) 20%, transparent 20%);
          background-size: 16px 16px;
          border-radius: 50%;
          opacity: 0.7;
          pointer-events: none;
        }
        .certificate::after {
          content: "";
          position: absolute;
          left: -120px;
          bottom: -120px;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(14, 165, 233, 0.2) 20%, transparent 20%);
          background-size: 16px 16px;
          transform: rotate(45deg);
          border-radius: 50%;
          opacity: 0.7;
          pointer-events: none;
        }
        .top-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          z-index: 2;
        }
        .logo {
          max-height: 52px;
          width: auto;
          object-fit: contain;
        }
        .header-section {
          margin-top: 2px;
          z-index: 2;
        }
        h1 {
          font-size: clamp(24px, 4.5vw, 48px);
          font-weight: 800;
          color: #1b4b8f;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        h3 {
          font-size: clamp(12px, 2vw, 20px);
          font-weight: 700;
          color: #0284c7;
          letter-spacing: 4px;
          margin-top: 2px;
          text-transform: uppercase;
        }
        .presented {
          font-size: clamp(11px, 1.5vw, 15px);
          color: #64748b;
          margin-top: 6px;
        }
        .name {
          font-size: clamp(20px, 3.8vw, 40px);
          font-weight: 800;
          color: #0369a1;
          border-bottom: 2px solid #38bdf8;
          display: inline-block;
          min-width: 60%;
          margin: 4px auto 8px;
          padding-bottom: 4px;
        }
        .completion-text {
          font-size: clamp(11px, 1.6vw, 15px);
          color: #475569;
        }
        .course-title {
          font-size: clamp(16px, 2.8vw, 30px);
          font-weight: 800;
          color: #0f172a;
          margin: 2px 0 4px;
        }
        .level-pill {
          display: inline-block;
          font-size: clamp(8px, 1.1vw, 11px);
          font-weight: 700;
          letter-spacing: 1.5px;
          color: #0284c7;
          background: rgba(2, 132, 199, 0.12);
          border: 1px solid rgba(2, 132, 199, 0.3);
          border-radius: 12px;
          padding: 2px 10px;
          margin: 2px 0 1px;
          text-transform: uppercase;
        }
        .tagline {
          font-size: clamp(11px, 1.6vw, 16px);
          font-weight: 700;
          color: #0284c7;
          margin-bottom: 4px;
        }
        .instructor-credit {
          font-size: clamp(9px, 1.2vw, 13px);
          font-weight: 600;
          color: #334155;
          margin-bottom: 4px;
        }
        .desc {
          width: 85%;
          margin: 0 auto;
          line-height: 1.45;
          font-size: clamp(10px, 1.3vw, 14px);
          color: #475569;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 90%;
          margin: 8px auto 0;
          z-index: 2;
        }
        .date {
          font-size: clamp(10px, 1.4vw, 14px);
          font-weight: 700;
          color: #1b4b8f;
        }
        .verify-text {
          font-size: clamp(8px, 1.1vw, 11px);
          color: #64748b;
          font-weight: 500;
          letter-spacing: 0.5px;
        }
        .cert-id {
          font-size: clamp(9px, 1.2vw, 12px);
          font-family: monospace;
          color: #64748b;
          font-weight: 600;
          letter-spacing: 1px;
        }
        .bottom-section {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          width: 100%;
          margin-top: 6px;
          padding-bottom: 4px;
          z-index: 2;
        }
        .sig-block {
          width: 28%;
          text-align: center;
        }
        .sig-line {
          width: 100%;
          border-top: 2px solid #334155;
          margin-bottom: 6px;
        }
        .sig-name {
          font-size: clamp(10px, 1.5vw, 15px);
          font-weight: 700;
          color: #0f172a;
        }
        .sig-title {
          font-size: clamp(9px, 1.2vw, 13px);
          color: #64748b;
        }
        .badge {
          height: clamp(50px, 9.5vw, 95px);
          width: auto;
          object-fit: contain;
          filter: drop-shadow(0 6px 12px rgba(0,0,0,0.18));
        }

        @media print {
          @page {
            size: A4 landscape;
            margin: 0;
          }
          html, body {
            background: #ffffff;
          }
          .cert-wrapper {
            width: 297mm;
            height: 210mm;
            padding: 0;
          }
          .certificate {
            width: 297mm;
            height: 210mm;
            max-width: none;
            aspect-ratio: none;
            border-radius: 0;
            border: none;
            box-shadow: none;
            padding: 28px 45px 32px;
            box-sizing: border-box;
          }
        }
      </style>
    </head>
    <body>
      <div class="cert-wrapper">
        <div class="certificate">
          <div class="top-row">
            <img src="${flowLogoBase64}" class="logo" alt="Flow Logo">
            <img src="${edodwajaLogoBase64}" class="logo" alt="Edodwaja Logo">
          </div>

          <div class="header-section">
            <h1>CERTIFICATE</h1>
            <h3>OF COMPLETION</h3>
          </div>

          <p class="presented">Presented to</p>
          <h2 class="name">${studentName}</h2>

          <p class="completion-text">for successfully completing <b>${daysText}</b> in the</p>
          ${level ? `<div class="level-pill">${level.toUpperCase()} LEVEL</div>` : ''}
          <h2 class="course-title">${courseName}</h2>
          <h4 class="tagline">"Learn by Doing – Future Tech Explorers"</h4>
          ${instructor ? `<p class="instructor-credit">Instructor: ${instructor}</p>` : ''}

          <p class="desc">
            demonstrating dedication, practical skill development, and hands-on mastery of core concepts through the FLOW learning initiative.
          </p>

          <div class="meta-row">
            <p class="date">Issued on ${displayDate}</p>
            <p class="verify-text">Verify at makersflow.com/verify</p>
            <p class="cert-id">${certId}</p>
          </div>

          <div class="bottom-section">
            <div class="sig-block">
              <div class="sig-line"></div>
              <h4 class="sig-name">The FLOW BUS</h4>
              <p class="sig-title">FLOW BUS</p>
            </div>
            <img src="${badgeBase64}" class="badge" alt="Gold Badge">
            <div class="sig-block">
              <div class="sig-line"></div>
              <h4 class="sig-name">Madhulash Babu</h4>
              <p class="sig-title">Founder & CEO</p>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

export default function CertificateScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    courseName,
    studentName,
    completionDate,
    daysCompleted,
    autoDownload,
    level,
    instructor,
  } = useLocalSearchParams<{
    courseName: string;
    studentName: string;
    completionDate: string;
    daysCompleted?: string;
    autoDownload?: string;
    level?: string;
    instructor?: string;
  }>();

  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [isLoadingHtml, setIsLoadingHtml] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const autoDownloadTriggered = useRef(false);

  let displayDate = 'N/A';
  try {
    const d = completionDate ? new Date(completionDate) : new Date();
    if (!isNaN(d.getTime())) {
      displayDate = d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } else {
      displayDate = new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
  } catch (err) {
    displayDate = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  const student = studentName || 'Student';
  const course = courseName || 'Course';
  const certId = generateCertId(student, course, completionDate || '');

  useEffect(() => {
    let isMounted = true;
    const prepareHtml = async () => {
      let flowLogoBase64 = TRANSPARENT_1X1_PNG;
      let edodwajaLogoBase64 = TRANSPARENT_1X1_PNG;
      let badgeBase64 = TRANSPARENT_1X1_PNG;

      try {
        const resolveAsset = async (module: any) => {
          try {
            const asset = Asset.fromModule(module);
            await asset.downloadAsync();
            const uri = asset.localUri || asset.uri || '';
            console.log('[Certificate Asset Debug]', { localUri: asset.localUri, uri: asset.uri });
            if (uri && Platform.OS !== 'web') {
              let targetUri = uri;
              if (!targetUri.startsWith('file://')) {
                const localFile = `${FileSystem.cacheDirectory}cert_asset_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
                await FileSystem.downloadAsync(uri, localFile);
                targetUri = localFile;
              }
              const base64Data = await FileSystem.readAsStringAsync(targetUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
              const extension = uri.split('.').pop()?.toLowerCase() || 'png';
              const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/png';
              return `data:${mime};base64,${base64Data}`;
            }
            return uri || TRANSPARENT_1X1_PNG;
          } catch (err) {
            console.warn('[Certificate] Error resolving asset:', err);
          }
          return TRANSPARENT_1X1_PNG;
        };

        flowLogoBase64 = await resolveAsset(require('@/assets/images/logos/flow_logo_transparent.png'));
        edodwajaLogoBase64 = await resolveAsset(require('@/assets/images/logos/edodwaja_logo_transparent.png'));
        badgeBase64 = await resolveAsset(require('@/assets/images/certificates/badge_transparent.png'));
      } catch (e) {
        console.error('[Certificate] Asset loading failed:', e);
      } finally {
        if (isMounted) {
          const html = getCertificateHtml(
            student,
            course,
            daysCompleted ?? 'N/A',
            displayDate,
            certId,
            flowLogoBase64,
            edodwajaLogoBase64,
            badgeBase64,
            level,
            instructor
          );
          setHtmlContent(html);
          setIsLoadingHtml(false);
        }
      }
    };

    prepareHtml();
    return () => {
      isMounted = false;
    };
  }, [student, course, daysCompleted, displayDate, certId, level, instructor]);

  const handleDownload = async () => {
    if (!htmlContent) return;
    setIsGenerating(true);
    try {
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(htmlContent);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
            printWindow.close();
          }, 500);
        } else {
          Alert.alert('Popup Blocked', 'Please allow popups to save/print the certificate.');
        }
        return;
      }

      const dir = `${FileSystem.documentDirectory}certificates/`;
      try {
        const dirInfo = await FileSystem.getInfoAsync(dir);
        if (dirInfo.exists) {
          await FileSystem.deleteAsync(dir, { idempotent: true });
        }
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      } catch (cleanErr) {
        console.warn('[Certificate] Directory cleanup warning:', cleanErr);
      }

      const { uri } = await Print.printToFileAsync({ html: htmlContent, base64: false });
      const dest = `${dir}certificate_${Date.now()}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: dest });

      if (Platform.OS === 'android') {
        try {
          const SAF = (FileSystem as any).StorageAccessFramework;
          const perm = await SAF.requestDirectoryPermissionsAsync();

          if (!perm.granted) {
            Alert.alert(
              'Save Cancelled',
              'No folder was chosen, so the certificate was not saved.',
              [{ text: 'OK' }]
            );
            setIsGenerating(false);
            return;
          }

          const rawBase64 = await FileSystem.readAsStringAsync(dest, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const cleanBase64 = rawBase64.replace(/[\r\n\s]/g, '');
          const fileName = `MakersFlow_Certificate_${Date.now()}`;
          const newUri = await SAF.createFileAsync(
            perm.directoryUri,
            fileName,
            'application/pdf'
          );
          await FileSystem.writeAsStringAsync(newUri, cleanBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          Alert.alert('✅ Downloaded!', 'Certificate saved to the folder you chose.', [
            { text: 'OK' },
          ]);
        } catch (safErr) {
          console.warn('[Certificate] SAF save failed:', safErr);
          Alert.alert(
            'Could Not Save',
            'Saving to that folder failed. Use the Share button to save it elsewhere.',
            [{ text: 'OK' }]
          );
        }
        setIsGenerating(false);
        return;
      }

      // iOS
      const canShareIos = await Sharing.isAvailableAsync();
      if (canShareIos) {
        await Sharing.shareAsync(dest, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save Certificate',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('✅ Saved!', 'Certificate generated successfully.', [{ text: 'OK' }]);
      }
    } catch (e: any) {
      console.error('[Certificate] Download error:', e);
      Alert.alert('Error', 'Could not generate certificate PDF.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShare = async () => {
    if (!htmlContent) return;
    if (Platform.OS === 'web') {
      Alert.alert('Share', 'Sharing is not supported on web. Please download the PDF.');
      return;
    }
    setIsGenerating(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Certificate',
        });
      } else {
        Alert.alert('Saved', 'Sharing is not available. PDF generated successfully.');
      }
    } catch (err) {
      console.error('[Certificate] Share error:', err);
      Alert.alert('Error', 'Could not share certificate.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-download handler if navigated with autoDownload=true
  useEffect(() => {
    if (
      autoDownload === 'true' &&
      htmlContent &&
      !isLoadingHtml &&
      !autoDownloadTriggered.current
    ) {
      autoDownloadTriggered.current = true;
      handleDownload();
    }
  }, [autoDownload, htmlContent, isLoadingHtml]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 8,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text
          style={[
            styles.headerTitle,
            TEXT_STYLES.pageTitle,
            { color: colors.foreground, fontSize: 18 },
          ]}
        >
          Certificate
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Main Preview Container - Single Source of Truth WebView */}
      <View style={styles.previewContainer}>
        {isLoadingHtml || !htmlContent ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              Rendering Certificate...
            </Text>
          </View>
        ) : Platform.OS === 'web' ? (
          <iframe
            srcDoc={htmlContent}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: 12,
            }}
            title="Certificate Preview"
          />
        ) : (
          <RNWebView
            originWhitelist={['*']}
            source={{ html: htmlContent }}
            style={styles.webview}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            scalesPageToFit={true}
            bounces={false}
          />
        )}
      </View>

      {/* Actions Row */}
      <View style={[styles.actionsRow, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[
            styles.btn,
            { backgroundColor: colors.primary, opacity: isGenerating || isLoadingHtml ? 0.7 : 1 },
          ]}
          onPress={handleDownload}
          disabled={isGenerating || isLoadingHtml}
        >
          {isGenerating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="download" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={[styles.btnText, TEXT_STYLES.button, { color: '#FFF', fontSize: 14 }]}>
                Download PDF
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[styles.shareBtn, { borderColor: colors.primary }]}
          disabled={isGenerating || isLoadingHtml}
          onPress={handleShare}
        >
          <Ionicons
            name="share-social"
            size={18}
            color={colors.primary}
            style={{ marginRight: 6 }}
          />
          <Text
            style={[styles.shareBtnText, TEXT_STYLES.button, { color: colors.primary, fontSize: 14 }]}
          >
            Share
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  previewContainer: {
    flex: 1,
    padding: 12,
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  webview: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderRadius: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    width: '100%',
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    height: 48,
  },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    height: 48,
  },
  shareBtnText: { fontSize: 16, fontWeight: '700' },
});

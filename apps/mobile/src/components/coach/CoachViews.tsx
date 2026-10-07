import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText, Badge, Button, Card, InlineMessage, Row } from '@/components/ui';
import type { CoachResponse, CoachStatus, CoachTurn } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

/** Who answered, in plain words. Rules are never presented as AI. */
export function providerLabel(r: Pick<CoachResponse, 'provider'>): string {
  return r.provider.type === 'real_ai' ? 'AI coach' : 'Rule-based tip';
}

const DEGRADED: Record<NonNullable<CoachResponse['degraded']>, string> = {
  unconfigured: "The AI coach isn't connected, so this is a rule-based tip from your data.",
  no_consent: "You haven't let the AI coach use your data, so this is a rule-based tip that never left FORM. You can change that in Settings.",
  timeout: "The AI coach didn't answer in time, so this is a rule-based tip from your data.",
  rate_limited: 'The AI coach is busy right now, so this is a rule-based tip from your data.',
  provider_error: "The AI coach isn't available right now, so this is a rule-based tip from your data.",
  invalid_output: "The AI's answer didn't pass FORM's accuracy and safety checks, so this is a rule-based tip instead.",
  daily_limit: "You've used today's AI coaching, so these are rule-based tips until tomorrow.",
};

/** Explains a fallback; null when the AI answered (or rules are simply how this coach works). */
export function degradedNote(r: Pick<CoachResponse, 'degraded' | 'provider'>): string | null {
  if (r.degraded) return DEGRADED[r.degraded];
  return r.provider.type === 'real_ai' ? null : 'Rule-based coaching from your data — not AI.';
}

/** One coaching answer: the advice, what it's based on, and where to go next. */
export function CoachCard({ response: r, onAction, title, compact }: { response: CoachResponse; onAction?: (route: string) => void; title?: string; compact?: boolean }) {
  const ai = r.provider.type === 'real_ai';
  const note = degradedNote(r);
  return (
    <Card style={[{ gap: space.sm }, r.priority === 'high' && { borderWidth: 1, borderColor: colors.accentSoft }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <Ionicons name={ai ? 'chatbubble-ellipses-outline' : 'list'} size={16} color={ai ? colors.primary : colors.textMuted} />
          <AppText variant="label" color={colors.textMuted}>
            {title ?? providerLabel(r)}
          </AppText>
        </Row>
        {title ? <Badge label={providerLabel(r)} tone={ai ? 'purple' : 'neutral'} /> : null}
      </Row>
      <View accessibilityLiveRegion="polite">
        <AppText variant="body">{r.message}</AppText>
      </View>
      {!compact && r.evidence.length > 0 ? (
        <View style={styles.evidence} accessible accessibilityLabel={`Based on: ${r.evidence.map((e) => `${e.claim}, ${e.value}`).join('; ')}`}>
          <AppText variant="caption" color={colors.textFaint}>
            Based on
          </AppText>
          {r.evidence.map((e) => (
            <View key={e.fact} style={styles.chip}>
              <AppText variant="caption" color={colors.textMuted}>
                {e.claim}: <AppText variant="caption" color={colors.text}>{e.value}</AppText>
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      {onAction && r.actions.length > 0 ? (
        <View style={styles.actions}>
          {r.actions.map((a) => (
            <Button key={a.route} label={a.label} variant="secondary" iconRight="arrow-forward" onPress={() => onAction(a.route)} />
          ))}
        </View>
      ) : null}
      {note ? (
        <AppText variant="caption" color={colors.textFaint}>
          {note}
        </AppText>
      ) : null}
    </Card>
  );
}

/** Starting points that map to what the coach can actually speak to. */
export const COACH_SUGGESTIONS = [
  'How was my last workout?',
  "How's my form?",
  'How is my eating today?',
  'Am I on track this week?',
  'How do I beat my records?',
  'How do I reach the next Body Quest stage?',
  'How do I level up?',
];

export interface CoachChatViewProps {
  turns: CoachTurn[];
  status: CoachStatus;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onAction: (route: string) => void;
  onClear: () => void;
}

/** Coach chat: the conversation, quick questions, the composer, and plain privacy and safety notes. */
export function CoachChatView({ turns, status, sending, error, onSend, onAction, onClear }: CoachChatViewProps) {
  const [draft, setDraft] = useState('');
  const send = (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    onSend(t);
    setDraft('');
  };
  const rules = status.mode === 'deterministic_fallback';

  return (
    <View style={{ gap: space.md }}>
      {rules ? (
        <InlineMessage tone="info" icon="list">
          {status.reason === 'unconfigured'
            ? "The AI coach isn't connected yet. Answers here are rule-based tips from your own data — clearly labelled, never presented as AI."
            : status.reason === 'consent_required'
              ? "You haven't let the AI coach use your data, so answers here are rule-based tips that never leave FORM. Turn on “Let the AI coach use my data” in Settings for AI coaching."
              : 'This coach gives rule-based tips from your own data. It matches your question to a topic; it does not hold a conversation.'}
        </InlineMessage>
      ) : null}

      {turns.length === 0 ? (
        <AppText variant="body" color={colors.textMuted}>
          Ask about your training, form, food, consistency or progress. Answers use only what FORM knows about you.
        </AppText>
      ) : (
        turns.map((t) =>
          t.role === 'user' ? (
            <View key={t.id} style={styles.mine} accessible accessibilityLabel={`You: ${t.text}`}>
              <AppText variant="body">{t.text}</AppText>
            </View>
          ) : t.response ? (
            <CoachCard key={t.id} response={t.response} onAction={onAction} />
          ) : null,
        )
      )}
      {sending ? (
        <View style={styles.row} accessible accessibilityLabel="The coach is answering">
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          <AppText variant="caption" color={colors.textMuted}>
            Checking your data…
          </AppText>
        </View>
      ) : null}
      {error ? <InlineMessage tone="warning">{error}</InlineMessage> : null}

      <View style={styles.suggestions}>
        {COACH_SUGGESTIONS.map((s) => (
          <Pressable key={s} accessibilityRole="button" onPress={() => send(s)} disabled={sending} style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.7 }]}>
            <AppText variant="caption" color={colors.text}>
              {s}
            </AppText>
          </Pressable>
        ))}
      </View>

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Message the coach"
          placeholder="Ask your coach…"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          value={draft}
          onChangeText={setDraft}
          maxLength={status.chat.maxChars}
          multiline
          style={styles.input}
          onSubmitEditing={() => send(draft)}
        />
        <Button label="Send" onPress={() => send(draft)} disabled={!draft.trim() || sending} loading={sending} />
      </View>
      {draft.length > status.chat.maxChars * 0.8 ? (
        <AppText variant="caption" color={colors.textFaint}>
          {draft.length} / {status.chat.maxChars}
        </AppText>
      ) : null}

      <AppText variant="caption" color={colors.textFaint}>
        {status.settings?.keepHistory === false
          ? 'Coaching, not medical advice — for pain or health concerns, see a professional. Chat history is off: nothing here is stored. Don’t share passwords or personal details.'
          : `Coaching, not medical advice — for pain or health concerns, see a professional. Chats are kept for ${status.retentionDays} days. Don’t share passwords or personal details.`}
      </AppText>
      {turns.length > 0 ? <Button label="Clear chat" variant="ghost" icon="trash-outline" onPress={onClear} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  evidence: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  chip: { backgroundColor: colors.cardRaised, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  actions: { gap: space.xs },
  mine: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.primarySoft, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  suggestion: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 36, justifyContent: 'center' },
  composer: { gap: space.sm },
  input: { minHeight: 48, maxHeight: 140, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, color: colors.text, backgroundColor: colors.card, fontSize: 16 },
});

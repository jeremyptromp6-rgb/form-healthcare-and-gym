import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CoachChatView } from '@/components/coach/CoachViews';
import { AppText, ErrorState, heroInk, IconButton, PhotoHero, Row, Screen, StateView } from '@/components/ui';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import type { ApiError } from '@/lib/api';
import { uuid } from '@/lib/dates';
import { heroPhoto } from '@/lib/heroPhotos';
import { proFeatureOf } from '@/lib/pro';
import type { PremiumFeatureId } from '@/lib/types';
import { space } from '@/theme/tokens';
import { useClearCoachMessages, useCoachMessages, useCoachStatus, useSendCoachMessage } from '@/lib/queries';

/** Coach chat. The server builds the context, validates every answer, and says who answered. */
export default function CoachScreen() {
  const status = useCoachStatus();
  const messages = useCoachMessages();
  const send = useSendCoachMessage();
  const clear = useClearCoachMessages();
  const [error, setError] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const [proLocked, setProLocked] = useState<PremiumFeatureId | null>(null);
  const closeButton = (color?: string) => <IconButton icon="close" label="Close coach" color={color} onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))} />;
  const close = closeButton();

  if (status.isError && !status.data) return <Screen title="Coach" right={close}><ErrorState error={status.error} onRetry={status.refetch} /></Screen>;
  if (messages.isError && !messages.data) return <Screen title="Coach" right={close}><ErrorState error={messages.error} onRetry={messages.refetch} /></Screen>;
  if (!status.data || !messages.data) return <Screen title="Coach" right={close}><StateView kind="loading" /></Screen>;
  if (status.data.mode === 'unavailable') {
    const byUser = status.data.reason === 'disabled_by_user';
    return (
      <Screen title="Coach" right={close}>
        <StateView
          kind="empty"
          title="The coach is switched off"
          message={byUser ? 'You turned coaching off. Nothing is being analysed. Turn it back on in Settings whenever you like.' : "Coaching isn't available on this server right now."}
          actionLabel={byUser ? 'Open settings' : undefined}
          onAction={byUser ? () => router.replace('/profile/settings' as Href) : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Coach"
      subtitle={status.data.mode === 'real_ai' ? 'AI coach · your data only' : 'Rule-based tips · your data only'}
      hero={
        <PhotoHero source={heroPhoto('coach')} minHeight={200}>
          <Row gap={space.sm} style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label" color={heroInk.muted}>
                {status.data.mode === 'real_ai' ? 'AI coach · your data only' : 'Rule-based tips · your data only'}
              </AppText>
              <AppText variant="screenTitle" header color={heroInk.text}>
                Coach
              </AppText>
            </View>
            {closeButton(heroInk.text)}
          </Row>
        </PhotoHero>
      }>
      <CoachChatView
        turns={messages.data.messages}
        status={status.data}
        sending={send.isPending}
        error={error}
        // Resolves to false on failure so the chat puts the typed text back.
        onSend={async (message) => {
          setError(null);
          try {
            await send.mutateAsync({ message, clientMessageId: uuid() });
            return true;
          } catch (e) {
            const err = e as ApiError;
            setProLocked(proFeatureOf(err));
            setError(err.kind === 'rate_limited' || err.kind === 'pro_required' ? err.message : err.kind === 'network' ? "Couldn't reach the coach. Check your connection and try again." : err.message);
            return false;
          }
        }}
        onAction={(route) => router.push(route as Href)}
        onClear={() => {
          setClearError(null);
          clear.mutate(undefined, { onError: (e) => setClearError(e.kind === 'network' ? "Couldn't clear the chat. Check your connection and try again." : e.message) });
        }}
        clearError={clearError}
        clearing={clear.isPending}
      />
      {proLocked ? <ProUpsellFor feature={proLocked} compact /> : null}
    </Screen>
  );
}

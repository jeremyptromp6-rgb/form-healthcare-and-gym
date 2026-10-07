import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { CoachChatView } from '@/components/coach/CoachViews';
import { ErrorState, IconButton, Screen, StateView } from '@/components/ui';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { uuid } from '@/lib/dates';
import { proFeatureOf } from '@/lib/pro';
import type { PremiumFeatureId } from '@/lib/types';
import { useClearCoachMessages, useCoachMessages, useCoachStatus, useSendCoachMessage } from '@/lib/queries';

/** Coach chat. The server builds the context, validates every answer, and says who answered. */
export default function CoachScreen() {
  const status = useCoachStatus();
  const messages = useCoachMessages();
  const send = useSendCoachMessage();
  const clear = useClearCoachMessages();
  const [error, setError] = useState<string | null>(null);
  const [proLocked, setProLocked] = useState<PremiumFeatureId | null>(null);
  const close = <IconButton icon="close" label="Close coach" onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))} />;

  if (status.isError && !status.data) return <Screen title="Coach" right={close}><ErrorState error={status.error} onRetry={status.refetch} /></Screen>;
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
    <Screen title="Coach" subtitle={status.data.mode === 'real_ai' ? 'AI coach · your data only' : 'Rule-based tips · your data only'} right={close}>
      <CoachChatView
        turns={messages.data.messages}
        status={status.data}
        sending={send.isPending}
        error={error}
        onSend={(message) => {
          setError(null);
          send.mutate(
            { message, clientMessageId: uuid() },
            {
              onError: (e) => {
                setProLocked(proFeatureOf(e));
                setError(e.kind === 'rate_limited' || e.kind === 'pro_required' ? e.message : e.kind === 'network' ? "Couldn't reach the coach. Check your connection and try again." : e.message);
              },
            },
          );
        }}
        onAction={(route) => router.push(route as Href)}
        onClear={() => clear.mutate()}
      />
      {proLocked ? <ProUpsellFor feature={proLocked} compact /> : null}
    </Screen>
  );
}

import { router, type Href } from 'expo-router';
import { WelcomeView } from '@/components/welcome/WelcomeView';

/** The first thing a signed-out visitor sees: what FORM is, then the way in. */
export default function Welcome() {
  return <WelcomeView onGetStarted={() => router.push('/sign-in?mode=register' as Href)} onSignIn={() => router.push('/sign-in' as Href)} />;
}

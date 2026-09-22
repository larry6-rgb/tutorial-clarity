export type SupportKnowledgeEntry = {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  version: string;
  effectiveDate: string;
  approved: boolean;
};

// This is the customer-facing source of truth for the support assistant.
// Add or revise entries here, review them, then set approved: true.
export const supportKnowledge: SupportKnowledgeEntry[] = [
  {
    id: 'getting-started', title: 'Getting started', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['start', 'youtube url', 'watch video', 'home', 'use'],
    content: 'Sign in, paste a YouTube URL or 11-character video ID into the box on the Tutorial Clarity home screen, and choose Watch Video. The Tutorial Clarity watch page opens the YouTube video with the additional controls beside it.'
  },
  {
    id: 'youtube-control-capture', title: 'Tutorial controls appear unresponsive', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['controls', 'unresponsive', 'play', 'pause', 'spacebar', 'not work', 'youtube'],
    content: 'YouTube sometimes keeps control of playback, which can make Tutorial Clarity controls appear unresponsive. Click the YouTube player itself, use YouTube’s own pause control once, and then try the Tutorial Clarity control again. This usually releases playback control. If it still fails, note the browser, the control used, and what happened, then escalate.'
  },
  {
    id: 'account-password', title: 'Account and password changes', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['account', 'password', 'change password', 'forgot', 'sign in', 'sign out'],
    content: 'Open Account Settings from the signed-in home page. The account page includes Change password or Create password. A password-based account must enter its current password first. Someone who cannot sign in should use Forgot password on the sign-in page. Never ask a customer to provide a password, verification code, or passkey.'
  },
  {
    id: 'trial-upgrade', title: 'Free trial and upgrading', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['trial', 'upgrade', 'pay', 'plan', 'billing', 'subscribe', 'price', 'subtamer', 'discount'],
    content: 'New accounts receive a 14-day free trial with no credit card required and full access to the premium tools. When the trial ends, the three core premium tools—Clarify Audio, AI Video Summaries, and Clean Transcript Downloads—require a paid plan. Base viewing tools such as Zoom, Resume, Saved Videos, and Keyboard Shortcuts remain available without premium access. The standard Tutorial Clarity price is $12.99 per month or $99 per year ($8.25 per month when averaged across the year). An existing SubTamer subscriber with an active SubTamer key can get Tutorial Clarity for $8 per month instead of $12.99 per month. This is $8 more per month in addition to the separate $4.99 monthly SubTamer subscription. The customer enters the SubTamer key in the Already a SubTamer subscriber section of the Tutorial Clarity plans page. If SubTamer is later canceled, Tutorial Clarity returns to $12.99 per month after advance email notice. View Plans / Upgrade is available from the signed-in home page and Account Settings. Existing paid customers can use the billing-management option in their account. Do not request card details or a SubTamer key in chat.'
  },
  {
    id: 'premium-usage', title: 'Premium usage limits and additional sessions', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['paywall', 'premium', 'limit', 'usage', 'sessions', 'reset', 'additional', 'overage', 'pack'],
    content: 'Every paid Tutorial Clarity plan includes 20 Clarify Audio sessions during each billing month. The 20-session allowance refreshes at the beginning of the next billing period. AI Video Summaries and Clean Transcript Downloads are premium features, but the published 20-session counter specifically measures Clarify Audio use. If a subscriber needs more Clarify Audio use before the monthly refresh, a one-time $8.99 session pack adds 20 bonus sessions. Bonus sessions are added immediately, never expire, and multiple packs may be purchased. Purchasing a pack does not change the subscription. A session pack requires an active subscription.'
  },
  {
    id: 'clarify-audio', title: 'Clarify Audio and translation', version: '1.1', effectiveDate: '2026-09-22', approved: true,
    keywords: ['clarify', 'audio', 'translation', 'accent', 'speaker', 'voice'],
    content: 'Clarify Audio can make difficult speech easier to understand and can translate supported audio. It is an AI feature available during the trial and on paid plans. Open 8. CLARIFY AUDIO & TRANSLATION in the watch-page menu and choose the processing mode and language. Processing can take a couple of minutes. For voice translation, wait until the panel says Audio Ready and the green Play Clarified Audio button appears; click that green button before listening. Starting the YouTube video again before clicking Play Clarified Audio plays the original audio, not the translated voice. If the customer says the audio did not translate, first ask: Did you wait for the green Play Clarified Audio button to appear and click it before listening? If not, explain that step and ask them to try it. If they did, or it still fails, troubleshoot interactively: give only one concrete action at a time, ask them to confirm completion or report exactly what appeared, then choose the next step based on their reply. Start by checking that they selected AI-generated speech rather than subtitles only; then check whether processing reached Audio Ready or showed an error; then check what happens after they click Play Clarified Audio, including whether YouTube is muted and what language they hear. Do not dump the entire checklist at once or claim that the customer completed a step. Availability can depend on whether usable captions or audio can be obtained from the YouTube video. If the panel reports a specific error, address that error rather than restarting the generic sequence.'
  },
  {
    id: 'zoom-spyglass', title: 'Zoom and Sherlock Spyglass', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['zoom', 'spyglass', 'magnify', 'detail', 'enlarge'],
    content: 'Zoom lets the viewer draw a box around an area and enlarge it. Sherlock Spyglass provides a movable magnified view for examining details without permanently changing the whole picture. Open the corresponding numbered section in the watch-page menu for its controls.'
  },
  {
    id: 'resume-save', title: 'Resume and saved videos', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['resume', 'saved', 'place', 'continue', 'caps lock', 'extension'],
    content: 'Tutorial Clarity remembers recent video positions so viewers can resume from the Resume Previous Video section. The browser extension can save a YouTube video by double-tapping Caps Lock while on YouTube; a green confirmation appears, and Tutorial Clarity must be running for the saved video to appear.'
  },
  {
    id: 'summary-transcript-definition', title: 'Summary, transcript, definitions, and AI Q&A', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['summary', 'transcript', 'definition', 'question', 'q&a', 'chapters'],
    content: 'Summary creates a plain-language overview when the video supplies usable captions. Transcript displays and can export available transcript text. Definitions explain selected terms. AI Q&A answers questions from the video transcript. Caption availability and YouTube access can affect these features; AI features require trial or paid access.'
  },
  {
    id: 'indexing', title: 'Video indexing', version: '1.2', effectiveDate: '2026-09-22', approved: true,
    keywords: ['index', 'channel', 'search videos', 'catalog'],
    content: 'When a customer already has Tutorial Clarity open and asks how to index a subscribed YouTube channel, give this direct sequence: 1. Click the Tutorial Clarity icon in the browser toolbar at the upper right. 2. On YouTube, open Subscriptions; if it is hidden, open the hamburger menu and choose Subscriptions. 3. Find the channel subscription to index. 4. Right-click that channel and choose Copy link address. Click the red button at the lower right to return to Tutorial Clarity. 5. Open the right-side menu and expand 16. VIDEO INDEXING. 6. Right-click inside the field labeled by the placeholder "@channelhandle or channel URL". 7. Choose Paste. 8. Click Index Channel. Once the channel catalog appears, select a video from the list or type a video title in the Search videos by title box. Video Indexing is available during the full-access 14-day trial; after the trial, it requires a paid Tutorial Clarity plan. The on-screen field is an input, not an "Enter Channel" button, and the action button currently reads "Index Channel", not "Index Video".'
  },
  {
    id: 'privacy-escalation', title: 'Privacy and human support', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['human', 'support', 'email', 'unknown', 'privacy', 'help'],
    content: 'Do not make referral to a person the default, and do not describe the fallback as human support. First answer from verified knowledge and ask whether the answer was satisfactory. If the customer says no, apologize and ask which part was unclear, which part was unanswered, or whether they can rephrase the question. Use their clarification to try again. Continue a useful troubleshooting or clarification dialogue while progress is being made. Only when multiple good-faith repair attempts have failed or the conversation is repeating without progress, apologize and say: Let me have some more time to research this and get back to you with a more comprehensive answer. Then ask how the customer can be reached, accepting either an email address or callback number. Explain that someone will respond as soon as possible, but that the request is reviewed periodically rather than continuously. Never request passwords, authentication codes, passkeys, card data, API keys, SubTamer keys, or other secrets.'
  }
];

export function getApprovedSupportKnowledge() {
  const today = new Date().toISOString().slice(0, 10);
  return supportKnowledge.filter((entry) => entry.approved && entry.effectiveDate <= today);
}

export const featureIntakeTemplate = {
  title: '', purpose: '', userWorkflow: '', expectedBehavior: '', limitations: '',
  troubleshooting: '', screenshotsOrExamples: '', escalationRules: '',
  version: '', effectiveDate: '', approved: false,
};

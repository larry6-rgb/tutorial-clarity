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
    keywords: ['trial', 'upgrade', 'pay', 'plan', 'billing', 'subscribe', 'price'],
    content: 'New accounts receive a 14-day free trial with no credit card required. View Plans / Upgrade is available from the signed-in home page and Account Settings. Paid choices are shown on the plans page. Existing paid customers can use the billing-management option in their account. Do not request card details in chat.'
  },
  {
    id: 'clarify-audio', title: 'Clarify Audio and translation', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['clarify', 'audio', 'translation', 'accent', 'speaker', 'voice'],
    content: 'Clarify Audio can make difficult speech easier to understand and can translate supported audio. It is an AI feature available during the trial and on paid plans. Open Clarify Audio & Translation in the watch-page menu and follow the processing choices. Availability can depend on whether usable captions or audio can be obtained from the YouTube video.'
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
    id: 'indexing', title: 'Video indexing', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['index', 'channel', 'search videos', 'catalog'],
    content: 'Video Indexing is available on paid Tutorial Clarity plans. It builds a searchable channel catalog so the viewer can find videos by title. Open Video Indexing in the watch-page menu and enter or select the relevant YouTube channel as directed.'
  },
  {
    id: 'privacy-escalation', title: 'Privacy and human support', version: '1.0', effectiveDate: '2026-09-22', approved: true,
    keywords: ['human', 'support', 'email', 'unknown', 'privacy', 'help'],
    content: 'If the verified knowledge does not answer the problem or the suggested steps fail, offer to forward the conversation to human support. Ask only for a reply email and useful non-secret context. Never request passwords, authentication codes, passkeys, card data, API keys, or other secrets.'
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

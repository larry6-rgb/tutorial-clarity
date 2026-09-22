'use client';

import { useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: 'Hello. How can I help with Tutorial Clarity?' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offerEscalation, setOfferEscalation] = useState(false);
  const [awaitingFeedback, setAwaitingFeedback] = useState(false);
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const [repairAttempts, setRepairAttempts] = useState(0);
  const [topic, setTopic] = useState('Support question');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (!question || busy) return;
    const isClarification = awaitingClarification;
    if (!isClarification) setRepairAttempts(0);
    const next = [...messages, { role: 'user' as const, content: question }];
    setMessages(next); setText(''); setBusy(true); setOfferEscalation(false); setAwaitingFeedback(false); setAwaitingClarification(false);
    try {
      const res = await fetch('/api/support-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, history: messages.slice(-8), page: window.location.href, repairAttempts: isClarification ? repairAttempts : 0 }) });
      const data = await res.json();
      setMessages([...next, { role: 'assistant', content: data.answer || data.error || 'I could not answer that right now.' }]);
      setAwaitingFeedback(true);
      if (data.topic) setTopic(data.topic);
    } catch {
      setMessages([...next, { role: 'assistant', content: 'I am sorry—I could not complete that answer just now. Would you like to try asking it one more time in different words?' }]);
      setAwaitingClarification(true);
    } finally { setBusy(false); }
  }

  function answerWasHelpful() {
    setMessages([...messages, { role: 'user', content: 'Yes, that answered my question.' }, { role: 'assistant', content: 'Good. Is there anything else I can help you with?' }]);
    setAwaitingFeedback(false);
    setAwaitingClarification(false);
    setRepairAttempts(0);
  }

  function answerWasNotHelpful() {
    const nextAttempt = repairAttempts + 1;
    setAwaitingFeedback(false);
    if (nextAttempt >= 3) {
      setMessages([...messages, { role: 'user', content: 'No, that still did not answer my question.' }, { role: 'assistant', content: 'I am sorry. Let me have some more time to research this and get back to you with a more comprehensive answer.' }]);
      setOfferEscalation(true);
      setAwaitingClarification(false);
      setRepairAttempts(nextAttempt);
      return;
    }
    setMessages([...messages, { role: 'user', content: 'No, that did not fully answer my question.' }, { role: 'assistant', content: 'I am sorry. At what point was I unclear, or what portion of your question did I not answer fully? Could you rephrase or narrow that part so I can better understand it?' }]);
    setRepairAttempts(nextAttempt);
    setAwaitingClarification(true);
  }

  async function escalate() {
    setBusy(true);
    const res = await fetch('/api/support-escalate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, email, phone, topic, page: window.location.href }) });
    const data = await res.json();
    if (res.ok) { setSent(true); setOfferEscalation(false); }
    else setMessages([...messages, { role: 'assistant', content: data.error || 'The conversation could not be sent.' }]);
    setBusy(false);
  }

  if (!open) return <button onClick={() => setOpen(true)} className="fixed bottom-5 left-5 z-[100] flex items-center gap-2 rounded-full bg-blue-600 px-5 py-3 font-semibold text-white shadow-xl hover:bg-blue-500" aria-label="Open Tutorial Clarity support"><HelpCircle size={20}/> Help</button>;

  return (
    <section className="fixed bottom-4 left-4 z-[100] flex h-[min(620px,85vh)] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 text-white shadow-2xl" aria-label="Tutorial Clarity support chat">
      <header className="flex items-center justify-between bg-blue-700 px-4 py-3"><div><div className="font-bold">Tutorial Clarity Support</div><div className="text-xs text-blue-100">Ask in your own words</div></div><button onClick={() => setOpen(false)} aria-label="Close support"><X/></button></header>
      <div className="pink-scrollbar flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.map((m, i) => <div key={i} className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-blue-600' : 'bg-gray-800'}`}>{m.content}</div>)}
        {busy && <div className="text-sm text-gray-400">Working…</div>}
        {awaitingFeedback && !busy && !offerEscalation && <div className="rounded-xl border border-gray-700 bg-gray-900 p-3 text-sm"><p className="mb-2">Does that answer your question?</p><div className="flex gap-2"><button onClick={answerWasHelpful} className="rounded bg-blue-600 px-3 py-2 font-semibold hover:bg-blue-500">Yes</button><button onClick={answerWasNotHelpful} className="rounded bg-gray-700 px-3 py-2 font-semibold hover:bg-gray-600">No</button></div></div>}
        {offerEscalation && !sent && <div className="rounded-xl border border-amber-700 bg-amber-950 p-3 text-sm"><p className="mb-2">How can we reach you? Someone will get back to you as soon as possible. Requests are checked periodically, so please allow some time for a response.</p><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email address (optional)" className="mb-2 w-full rounded bg-gray-900 px-3 py-2"/><input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Callback number (optional)" className="mb-2 w-full rounded bg-gray-900 px-3 py-2"/><button onClick={escalate} disabled={busy || (!email.trim() && !phone.trim())} className="rounded bg-amber-500 px-3 py-2 font-semibold text-black disabled:opacity-50">Request a follow-up</button><p className="mt-2 text-xs text-amber-200">Provide either an email or callback number. Never include passwords, verification codes, passkeys, or payment-card information.</p></div>}
        {sent && <div className="rounded-xl border border-green-700 bg-green-950 p-3 text-sm text-green-200">Your question has been saved for additional research. Someone will contact you as soon as possible using the information you provided.</div>}
      </div>
      <form onSubmit={ask} className="flex gap-2 border-t border-gray-800 p-3"><input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="How do I…?" className="min-w-0 flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"/><button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-blue-600 p-2 disabled:opacity-50" aria-label="Send question"><Send size={20}/></button></form>
    </section>
  );
}

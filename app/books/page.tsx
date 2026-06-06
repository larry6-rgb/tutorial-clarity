import Link from 'next/link';

export const metadata = { title: 'Books — Tutorial Clarity' };

const books = [
  {
    id: 1,
    title: 'Conversational Spices',
    coverPlaceholder: true,
    // Replace coverImage with the actual path once artwork is found:
    // coverImage: '/images/conversational-spices-cover.jpg',
    sections: [
      {
        heading: 'Storytelling and Narrative Depth',
        body: 'Facts are not just stated, but told as mini-stories with context. Historical context is provided — dates, locations, people involved. Cause and effect relationships are explained.',
      },
      {
        heading: 'Detailed Explanations and the "Why" Behind Facts',
        body: 'Goes beyond surface-level information to explain mechanisms. Scientific reasoning provided. Multiple layers of information packed into single facts.',
      },
      {
        heading: 'Conversational and Engaging Tone',
        body: 'Direct address to the reader: "Astounding, isn\'t it?", "Believe it or not." Rhetorical questions, humor, wit, and personal commentary woven throughout.',
      },
      {
        heading: 'Practical Connections and Comparisons',
        body: 'Relates abstract concepts to familiar things. Example: lightning energy = toasting 100,000 bread slices. Modern relevance explained.',
      },
      {
        heading: 'Debunking Common Misconceptions',
        body: 'Corrects popular myths, explains why they exist, and provides accurate information with full context.',
      },
      {
        heading: 'Human Interest and Historical Anecdotes',
        body: 'Celebrity and historical figure connections, wartime stories, and the personal stories behind great inventions.',
      },
      {
        heading: 'Scientific Accuracy with Accessibility',
        body: 'Precise numbers and measurements provided. Technical terms explained in plain language. Sources and methodology mentioned when relevant.',
      },
    ],
    amazonUrl: null,
  },
];

export default function BooksPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* Flip card CSS */}
      <style>{`
        .flip-card {
          perspective: 1200px;
          cursor: pointer;
        }
        .flip-card-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          transition: transform 0.65s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .flip-card:hover .flip-card-inner,
        .flip-card.flipped .flip-card-inner {
          transform: rotateY(180deg);
        }
        .flip-card-front,
        .flip-card-back {
          position: absolute;
          width: 100%;
          height: 100%;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          border-radius: 12px;
          overflow: hidden;
        }
        .flip-card-back {
          transform: rotateY(180deg);
        }
      `}</style>

      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <Link
          href="/"
          className="text-2xl font-bold"
          style={{
            background: 'linear-gradient(135deg, #E6E6FA 0%, #4169E1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Tutorial Clarity
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-gray-300 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors"
          >
            Start Free Trial
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Books</h1>
        <p className="text-gray-400 mb-14 text-lg">
          Click any cover to read what's inside.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      </main>

      <footer className="border-t border-gray-800 px-8 py-10 text-center text-gray-500 text-sm mt-16">
        <p className="mb-2">
          <span className="font-semibold text-gray-400">Tutorial Clarity</span> — by Eppler Publishing LLC
        </p>
        <div className="flex justify-center gap-6">
          <Link href="/books" className="hover:text-gray-300 transition-colors">Books</Link>
          <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</Link>
          <Link href="/about" className="hover:text-gray-300 transition-colors">About</Link>
        </div>
      </footer>
    </div>
  );
}

function BookCard({ book }: { book: typeof books[0] }) {
  return (
    <div className="flip-card w-full" style={{ height: '520px' }}>
      <div className="flip-card-inner">

        {/* Front — cover */}
        <div className="flip-card-front bg-gray-800 border border-gray-700 flex flex-col items-center justify-center">
          {book.coverPlaceholder ? (
            <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center">
              <div className="w-44 h-64 bg-gradient-to-br from-red-900 to-red-700 rounded-lg mb-5 flex flex-col items-center justify-center shadow-xl px-4">
                <span className="text-4xl mb-3">📖</span>
                <p className="text-white font-bold text-lg text-center leading-tight">{book.title}</p>
                <p className="text-red-300 text-xs mt-2">by Eppler Publishing LLC</p>
              </div>
              <p className="text-gray-400 text-sm">Cover artwork coming soon</p>
              <p className="text-gray-500 text-xs mt-1">Hover to read about this book</p>
            </div>
          ) : (
            // <img src={book.coverImage} alt={book.title} className="w-full h-full object-cover" />
            null
          )}
        </div>

        {/* Back — AI evaluation / description */}
        <div className="flip-card-back bg-gray-900 border border-gray-700 flex flex-col justify-between">
          <div className="overflow-y-auto flex-1 p-5">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
              AI Evaluation — {book.title}
            </p>
            <div className="space-y-3">
              {book.sections.map((section) => (
                <div key={section.heading}>
                  <p className="text-white font-semibold text-xs leading-snug">{section.heading}</p>
                  <p className="text-gray-400 text-xs leading-relaxed mt-0.5">{section.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="px-5 py-4 border-t border-gray-700">
            {book.amazonUrl ? (
              <a
                href={book.amazonUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Buy on Amazon →
              </a>
            ) : (
              <p className="text-center text-gray-500 text-sm italic">
                Coming soon through Amazon KDP
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

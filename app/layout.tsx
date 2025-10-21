export const metadata = {
  title: 'Tutorial Clarity',
  description: 'Enhanced YouTube tutorial player',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: '100%' }}>
      <body
        style={{
          margin: 0,
          height: '100%',
          minHeight: '100vh',
          background: 'transparent',
        }}
      >
        {children}
      </body>
    </html>
  );
}
import React from 'react';

/**
 * Last line of defence: a render error anywhere in the dashboard shows a friendly screen with a reload button
 * instead of a blank page. (The live map has its own, smaller boundary.) Uses plain classes only, so it still
 * looks right if the error came from a styled component.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) {
    // Only the message: nothing from the page (tokens, customer data) goes to the console.
    console.error('dashboard crashed:', error instanceof Error ? error.message : 'unknown error');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-kraveo-night px-6 text-center">
        <h1 className="font-display text-2xl font-bold text-kraveo-ink">Un problème est survenu</h1>
        <p className="max-w-sm text-sm text-kraveo-ink2">Le tableau de bord a rencontré un problème inattendu. Recharger la page règle généralement le souci, et vous restez connecté.</p>
        <button type="button" className="k-btn-accent" onClick={() => window.location.reload()}>Recharger</button>
      </div>
    );
  }
}

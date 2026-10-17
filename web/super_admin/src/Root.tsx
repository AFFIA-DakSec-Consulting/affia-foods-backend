import React, { useCallback, useEffect, useState } from 'react';
import { App } from './App';
import { PartnerAuthScreen } from './components/PartnerAuthScreen';
import { RestaurantApp } from './components/RestaurantApp';
import { getSessionRole, isAuthenticated } from './services/api';
import { RESTAURANT_LOGIN_PATH, goTo, publicRestaurantPage } from './lib/route';
import { DEFAULT_TAB, pathForTab } from './lib/navigation';

const RESTAURANT_HOME = pathForTab(DEFAULT_TAB.restaurant);

/** Picks the space: a restaurant's own (public sign-up / sign-in pages, then its session), or the operations team's console. */
export const Root: React.FC = () => {
  const [path, setPath] = useState(() => window.location.pathname);
  // Bumped when a session starts or ends so the choice below is made again.
  const [, setSessionTick] = useState(0);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const restaurantSession = isAuthenticated() && getSessionRole() === 'VENDOR';
  const publicPage = publicRestaurantPage(path);

  // A signed-in restaurant has no use for the sign-up / sign-in pages.
  useEffect(() => {
    if (restaurantSession && publicPage) goTo(RESTAURANT_HOME, true);
  }, [restaurantSession, publicPage]);

  const started = useCallback(() => { setSessionTick((n) => n + 1); goTo(RESTAURANT_HOME, true); }, []);
  const ended = useCallback(() => { setSessionTick((n) => n + 1); goTo(RESTAURANT_LOGIN_PATH, true); }, []);

  if (restaurantSession) return <RestaurantApp onLogout={ended} />;
  if (publicPage) return <PartnerAuthScreen key={publicPage} mode={publicPage} onSession={started} />;
  return <App />;
};

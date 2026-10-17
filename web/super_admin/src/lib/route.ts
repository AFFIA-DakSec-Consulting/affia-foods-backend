/** Moves to another address without reloading the page; every listener of `popstate` (the root, the admin) re-reads the path. */
export const goTo = (path: string, replace = false): void => {
  if (window.location.pathname === path) return;
  if (replace) window.history.replaceState(null, '', path); else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const RESTAURANT_SIGNUP_PATH = '/restaurant/inscription';
export const RESTAURANT_LOGIN_PATH = '/restaurant/connexion';

/** The two public pages of the restaurant space (no session needed). */
export const publicRestaurantPage = (pathname: string): 'signup' | 'login' | null => {
  const clean = pathname.replace(/\/+$/, '');
  if (clean === RESTAURANT_SIGNUP_PATH) return 'signup';
  if (clean === RESTAURANT_LOGIN_PATH) return 'login';
  return null;
};

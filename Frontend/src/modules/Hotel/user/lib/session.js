import { USER_TOKEN_KEY } from "../../shared/hotelApi";

// The customer session is owned by the shared login at /login (modules/auth), which
// stores `user_accessToken` and the profile in `user_user` (Food utils/auth.js
// setAuthData). Hotel screens only read it.

export const LOGIN_PATH = "/login";
export const PROFILE_PATH = "/food/user/profile";

export const getUserToken = () => {
  try {
    return localStorage.getItem(USER_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

export const getUserProfile = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user_user") || "null");
    return user && typeof user === "object" ? user : null;
  } catch {
    return null;
  }
};

/**
 * Send the visitor to the shared login. Login.jsx returns to
 * `location.state.from.pathname` after a successful OTP, and navigate() accepts a
 * path with a query string there, so the full checkout URL survives the round trip.
 */
export const loginRedirect = (navigate, returnTo, { replace = false } = {}) =>
  navigate(LOGIN_PATH, { replace, state: { from: { pathname: returnTo } } });

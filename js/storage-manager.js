const safeSessionStorage = typeof sessionStorage !== 'undefined'
  ? sessionStorage
  : {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {}
    };

const PIN_PREFIX = 'growx.pin.';
const SCREEN_KEY = 'growx.ui.screen';

export const storageManager = {
  setPinVerified(userId, value) {
    if (!userId) return;
    safeSessionStorage.setItem(`${PIN_PREFIX}${userId}`, value ? 'true' : 'false');
  },

  isPinVerified(userId) {
    return userId ? safeSessionStorage.getItem(`${PIN_PREFIX}${userId}`) === 'true' : false;
  },

  clearPinVerification(userId) {
    if (!userId) return;
    safeSessionStorage.removeItem(`${PIN_PREFIX}${userId}`);
  },

  clearAll() {
    Object.keys(safeSessionStorage)
      .filter((key) => key.startsWith(PIN_PREFIX) || key === SCREEN_KEY)
      .forEach((key) => safeSessionStorage.removeItem(key));
  },

  setScreen(screenName) {
    safeSessionStorage.setItem(SCREEN_KEY, screenName);
  },

  getScreen() {
    return safeSessionStorage.getItem(SCREEN_KEY) || 'dashboard';
  }
};

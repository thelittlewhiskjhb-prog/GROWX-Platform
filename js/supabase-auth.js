import { supabase } from '../supabase-config.js';
import { apiClient } from './api-client.js';
import { storageManager } from './storage-manager.js';

function getAuthClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add your URL and anon key before using authentication.');
  }

  return supabase;
}

function assertPin(pin) {
  if (!/^\d{4}$/.test(pin || '')) {
    throw new Error('PIN must be exactly 4 digits.');
  }
}

export const supabaseAuth = {
  async registerClient({ email, phone, password, fullName, pin }) {
    assertPin(pin);

    if (!email && !phone) {
      throw new Error('Provide an email address or phone number to register.');
    }

    const payload = phone
      ? { phone, password, options: { data: { full_name: fullName || '', role: 'client' } } }
      : { email, password, options: { data: { full_name: fullName || '', role: 'client' } } };

    const { data, error } = await getAuthClient().auth.signUp(payload);
    if (error) throw error;

    if (data.session) {
      await apiClient.upsertMyProfile({ fullName, phone, pin });
    }

    return data;
  },

  async signInWithPassword({ identifier, password }) {
    const credentials = identifier.includes('@')
      ? { email: identifier, password }
      : { phone: identifier, password };

    const { data, error } = await getAuthClient().auth.signInWithPassword(credentials);
    if (error) throw error;
    return data;
  },

  async sendPhoneOtp(phone) {
    const { data, error } = await getAuthClient().auth.signInWithOtp({ phone });
    if (error) throw error;
    return data;
  },

  async verifyPhoneOtp({ phone, token }) {
    const { data, error } = await getAuthClient().auth.verifyOtp({
      phone,
      token,
      type: 'sms'
    });

    if (error) throw error;
    return data;
  },

  async verifyPin(pin) {
    assertPin(pin);
    const isValid = await apiClient.verifyPin(pin);
    const user = await this.getUser();
    if (user?.id && isValid) {
      storageManager.setPinVerified(user.id, true);
    }
    return isValid;
  },

  async getSession() {
    const { data, error } = await getAuthClient().auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async getUser() {
    const { data, error } = await getAuthClient().auth.getUser();
    if (error) throw error;
    return data.user;
  },

  async getProfile() {
    return apiClient.fetchProfile();
  },

  async signOut() {
    const user = await this.getUser().catch(() => null);
    if (user?.id) {
      storageManager.clearPinVerification(user.id);
    }
    storageManager.clearAll();
    const { error } = await getAuthClient().auth.signOut();
    if (error) throw error;
  },

  onAuthStateChange(callback) {
    return getAuthClient().auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        storageManager.clearAll();
      }
      callback(event, session);
    });
  }
};

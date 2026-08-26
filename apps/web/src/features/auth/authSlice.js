import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { permissionSatisfies } from '@sakha/shared';
import api from '../../lib/api.js';

export const loadSession = createAsyncThunk('auth/load', async (_arg, { rejectWithValue }) => {
  try {
    const { user } = await api.get('/auth/me');
    return user;
  } catch (err) {
    return rejectWithValue(err.message);
  }
});

export const signIn = createAsyncThunk('auth/signIn', async (credentials, { rejectWithValue }) => {
  try {
    const { user } = await api.post('/auth/login', credentials);
    return user;
  } catch (err) {
    return rejectWithValue({ message: err.message, fields: err.fields });
  }
});

export const signUp = createAsyncThunk('auth/signUp', async (details, { rejectWithValue }) => {
  try {
    const res = await api.post('/auth/register', details);
    return res.user ?? null;
  } catch (err) {
    return rejectWithValue({ message: err.message, fields: err.fields });
  }
});

export const signOut = createAsyncThunk('auth/signOut', async () => {
  await api.post('/auth/logout').catch(() => {});
  return null;
});

const initialState = {
  user: null,
  status: 'idle', // idle | loading | ready
  signingIn: false,
  error: null,
  fieldErrors: {},
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearAuthError(state) {
      state.error = null;
      state.fieldErrors = {};
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSession.pending, (state) => {
        state.status = state.status === 'idle' ? 'loading' : state.status;
      })
      .addCase(loadSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = 'ready';
      })
      .addCase(loadSession.rejected, (state) => {
        state.user = null;
        state.status = 'ready';
      })
      .addCase(signIn.pending, (state) => {
        state.signingIn = true;
        state.error = null;
        state.fieldErrors = {};
      })
      .addCase(signIn.fulfilled, (state, action) => {
        state.signingIn = false;
        state.user = action.payload;
        state.status = 'ready';
      })
      .addCase(signIn.rejected, (state, action) => {
        state.signingIn = false;
        state.error = action.payload?.message ?? 'Could not sign you in.';
        state.fieldErrors = action.payload?.fields ?? {};
      })
      .addCase(signUp.pending, (state) => {
        state.signingIn = true;
        state.error = null;
        state.fieldErrors = {};
      })
      .addCase(signUp.fulfilled, (state, action) => {
        state.signingIn = false;
        if (action.payload) state.user = action.payload;
        state.status = 'ready';
      })
      .addCase(signUp.rejected, (state, action) => {
        state.signingIn = false;
        state.error = action.payload?.message ?? 'Could not create that account.';
        state.fieldErrors = action.payload?.fields ?? {};
      })
      .addCase(signOut.fulfilled, (state) => {
        state.user = null;
      });
  },
});

export const { clearAuthError } = authSlice.actions;
export default authSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectUser = (s) => s.auth.user;
export const selectIsAuthenticated = (s) => Boolean(s.auth.user);
export const selectAuthReady = (s) => s.auth.status === 'ready';
export const selectRoles = (s) => s.auth.user?.roles ?? [];

/**
 * Mirrors the server's permission check exactly (same shared module), so the UI
 * hides what the API would refuse. The server remains the authority — this is
 * about not showing someone a button that will fail.
 */
export const selectCan = (permission) => (s) =>
  permissionSatisfies(s.auth.user?.permissions ?? [], permission);

export const selectCanAny = (...permissions) => (s) => {
  const held = s.auth.user?.permissions ?? [];
  return permissions.some((p) => permissionSatisfies(held, p));
};

/** Does this person see the admin area at all? */
export const selectIsStaff = (s) => {
  const roles = s.auth.user?.roles ?? [];
  return roles.some((r) => r !== 'client');
};

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api from '../../lib/api.js';

export const loadSakhaStatus = createAsyncThunk('sakha/status', async () => api.get('/sakha/status'));

/**
 * Send one message. The user's text is added optimistically so the panel feels
 * instant, then reconciled when the real reply lands — a turn can take several
 * seconds when Sakha decides to call three tools, and a frozen input during
 * that time reads as broken.
 */
export const sendMessage = createAsyncThunk(
  'sakha/send',
  async ({ message, pageContext }, { getState, rejectWithValue }) => {
    const { conversationId } = getState().sakha;
    try {
      return await api.post('/sakha/chat', { conversationId, message, pageContext });
    } catch (err) {
      return rejectWithValue({ message: err.message, code: err.code, status: err.status });
    }
  }
);

export const loadConversation = createAsyncThunk('sakha/loadConversation', async (id) => {
  const { conversation } = await api.get(`/sakha/conversations/${id}`);
  return conversation;
});

export const rateMessage = createAsyncThunk('sakha/rate', async ({ messageId, rating }) => {
  await api.post('/sakha/feedback', { messageId, rating });
  return { messageId, rating };
});

const STORAGE_KEY = 'sakha-conversation';

const restoreConversationId = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const sakhaSlice = createSlice({
  name: 'sakha',
  initialState: {
    open: false,
    docked: false,
    conversationId: restoreConversationId(),
    messages: [],
    pending: false,
    error: null,
    available: null,
    knowledge: null,
    ratings: {},
    unreadReply: false,
  },
  reducers: {
    openPanel(state) {
      state.open = true;
      state.unreadReply = false;
    },
    closePanel(state) {
      state.open = false;
    },
    togglePanel(state) {
      state.open = !state.open;
      if (state.open) state.unreadReply = false;
    },
    toggleDocked(state) {
      state.docked = !state.docked;
    },
    startNewConversation(state) {
      state.conversationId = null;
      state.messages = [];
      state.error = null;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* private browsing */
      }
    },
    dismissError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSakhaStatus.fulfilled, (state, action) => {
        state.available = action.payload.available;
        state.knowledge = action.payload.knowledge;
        state.statusReason = action.payload.reason;
      })
      .addCase(loadSakhaStatus.rejected, (state) => {
        state.available = false;
      })
      .addCase(sendMessage.pending, (state, action) => {
        state.pending = true;
        state.error = null;
        state.messages.push({
          id: `local-${Date.now()}`,
          role: 'user',
          content: action.meta.arg.message,
          local: true,
        });
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        state.pending = false;
        state.conversationId = action.payload.conversationId;
        state.messages.push(action.payload.message);
        if (!state.open) state.unreadReply = true;
        try {
          localStorage.setItem(STORAGE_KEY, action.payload.conversationId);
        } catch {
          /* private browsing */
        }
      })
      .addCase(sendMessage.rejected, (state, action) => {
        state.pending = false;
        state.error = action.payload?.message ?? 'Sakha could not answer just then.';
        state.errorCode = action.payload?.code;
        // Drop the optimistic message so the user can edit and resend it.
        const last = state.messages.at(-1);
        if (last?.local) {
          state.messages.pop();
          state.retryText = last.content;
        }
      })
      .addCase(loadConversation.fulfilled, (state, action) => {
        state.conversationId = action.payload.id;
        state.messages = action.payload.messages ?? [];
      })
      .addCase(loadConversation.rejected, (state) => {
        // A thread we no longer own, or one that was pruned. Start clean.
        state.conversationId = null;
        state.messages = [];
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      })
      .addCase(rateMessage.fulfilled, (state, action) => {
        state.ratings[action.payload.messageId] = action.payload.rating;
      });
  },
});

export const {
  openPanel,
  closePanel,
  togglePanel,
  toggleDocked,
  startNewConversation,
  dismissError,
} = sakhaSlice.actions;

export default sakhaSlice.reducer;

export const selectSakhaOpen = (s) => s.sakha.open;
export const selectSakhaMessages = (s) => s.sakha.messages;
export const selectSakhaPending = (s) => s.sakha.pending;
export const selectSakhaAvailable = (s) => s.sakha.available;

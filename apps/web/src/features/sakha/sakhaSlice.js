import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { stream } from '../../lib/api.js';

export const loadSakhaStatus = createAsyncThunk('sakha/status', async () => api.get('/sakha/status'));

/**
 * Send one message. The user's text is added optimistically so the panel feels
 * instant, and the reply streams in: a status line while Sakha runs tools, then
 * the answer as it is written. The saved reply (cleaned, with its sources)
 * replaces the streamed text when it lands.
 */
export const sendMessage = createAsyncThunk(
  'sakha/send',
  async ({ message, pageContext }, { dispatch, getState, rejectWithValue }) => {
    const { conversationId } = getState().sakha;
    try {
      return await stream(
        '/sakha/chat/stream',
        { conversationId, message, pageContext },
        { onEvent: (event) => dispatch(sakhaSlice.actions.streamEvent(event)) }
      );
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

/** Open the panel and send a question on the visitor's behalf (prompt chips, "Talk to a human"). */
export const askSakha = (message) => (dispatch, getState) => {
  dispatch(sakhaSlice.actions.openPanel());
  if (getState().sakha.pending) return;
  dispatch(
    sendMessage({
      message,
      pageContext: { path: window.location.pathname, title: document.title },
    })
  );
};

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
    // The reply being written right now: { text, status }, or null.
    streaming: null,
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
    /** One event from a streaming reply: status, more text, or a reset. */
    streamEvent(state, action) {
      const event = action.payload;
      if (!state.streaming) return;
      if (event.type === 'status') state.streaming.status = event.text;
      if (event.type === 'delta') {
        state.streaming.text += event.text;
        state.streaming.status = null;
      }
      if (event.type === 'reset') state.streaming.text = '';
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
        state.streaming = { text: '', status: null };
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
        state.streaming = null;
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
        state.streaming = null;
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

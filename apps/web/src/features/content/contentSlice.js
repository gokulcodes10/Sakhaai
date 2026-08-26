import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api from '../../lib/api.js';

/**
 * The whole site's copy, fetched once and held in the store.
 *
 * Every page reads from here rather than hard-coding strings, which is what
 * makes the CMS real: an editor changes a headline and the component that
 * renders it needs no code change at all.
 */
export const loadContent = createAsyncThunk('content/load', async (_arg, { rejectWithValue }) => {
  try {
    return await api.get('/content');
  } catch (err) {
    return rejectWithValue(err.message);
  }
});

const contentSlice = createSlice({
  name: 'content',
  initialState: { data: null, pages: [], status: 'idle', error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadContent.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(loadContent.fulfilled, (state, action) => {
        state.data = action.payload.content;
        state.pages = action.payload.pages ?? [];
        state.status = 'ready';
        state.error = null;
      })
      .addCase(loadContent.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.payload ?? 'Could not load the site content.';
      });
  },
});

export default contentSlice.reducer;

export const selectContent = (s) => s.content.data;
export const selectContentReady = (s) => s.content.status === 'ready';
export const selectPages = (s) => s.content.pages;

/** Read a dot path out of the content tree with a fallback. */
export const selectPath = (path, fallback = null) => (s) => {
  const parts = path.split('.');
  let cursor = s.content.data;
  for (const part of parts) {
    if (cursor === undefined || cursor === null) return fallback;
    cursor = cursor[part];
  }
  return cursor ?? fallback;
};

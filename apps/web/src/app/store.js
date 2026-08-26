import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../features/auth/authSlice.js';
import contentReducer from '../features/content/contentSlice.js';
import sakhaReducer from '../features/sakha/sakhaSlice.js';
import uiReducer from '../features/ui/uiSlice.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    content: contentReducer,
    sakha: sakhaReducer,
    ui: uiReducer,
  },
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: {
        // Dates arrive as ISO strings from the API; nothing non-serializable
        // is ever put in the store, so the default check is enough.
        ignoredActions: [],
      },
    }),
  devTools: import.meta.env.DEV,
});

export default store;

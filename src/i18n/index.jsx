import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.js';
import hi from './hi.js';

const DICTIONARIES = { EN: en, HI: hi };
const STORAGE_KEY = 'pb_lang';

// localStorage can throw (private windows, blocked storage); the app works without it.
const readStored = () => {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
};
const writeStored = (lang) => {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
};

function initialLanguage() {
  const stored = readStored();
  if (stored === 'EN' || stored === 'HI') return stored;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('hi') ? 'HI' : 'EN';
}

const lookup = (dict, key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = lang === 'HI' ? 'hi' : 'en';
  }, [lang]);

  const setLang = useCallback((next) => {
    if (next !== 'EN' && next !== 'HI') return;
    writeStored(next);
    setLangState(next);
  }, []);

  /** t('profile.perDay', { n: 100 }) -> translated text; falls back to English, then to the key. */
  const t = useCallback(
    (key, vars) => {
      const text = lookup(DICTIONARIES[lang], key) ?? lookup(en, key) ?? key;
      if (typeof text !== 'string' || !vars) return text;
      return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t, hasStoredChoice: readStored() !== null }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

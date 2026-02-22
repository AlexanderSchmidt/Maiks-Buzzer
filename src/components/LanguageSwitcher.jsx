import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.language || 'en').substring(0, 2);

  return (
    <div className="flex items-center gap-1">
      <Globe className="w-3.5 h-3.5 text-gray-500" />
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => i18n.changeLanguage(lang.code)}
          className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
            current === lang.code
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}

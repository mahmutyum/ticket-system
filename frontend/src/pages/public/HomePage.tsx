import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Clock3, PlusCircle, Search, ShieldCheck } from 'lucide-react';

export default function HomePage() {
  const { t } = useTranslation();

  const steps: [string, string, string][] = [
    ['1', t('home.step1Title'), t('home.step1Text')],
    ['2', t('home.step2Title'), t('home.step2Text')],
    ['3', t('home.step3Title'), t('home.step3Text')],
  ];

  return (
    <div className="space-y-14 sm:space-y-20">
      <section className="grid items-center gap-10 py-8 lg:grid-cols-[1.15fr_.85fr] lg:py-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 dark:border-primary-500/20 dark:bg-primary-500/10 dark:text-primary-300"><CheckCircle2 className="h-4 w-4" /> {t('home.badge')}</span>
          <h2 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">{t('home.heroTitlePlain')} <span className="text-primary-600">{t('home.heroTitleAccent')}</span></h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">{t('home.heroSubtitle')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/create" className="btn-primary inline-flex items-center justify-center gap-2 px-5 py-3">{t('home.ctaCreate')} <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/track" className="btn-secondary inline-flex items-center justify-center gap-2 px-5 py-3"><Search className="h-4 w-4" /> {t('home.ctaTrack')}</Link>
          </div>
        </div>
        <div className="card relative overflow-hidden border-primary-100 bg-white/80 p-6 dark:border-primary-500/20 dark:bg-slate-900/80 sm:p-8">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary-200/40 blur-3xl" />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">{t('home.howItWorks')}</p>
          <ol className="relative mt-6 space-y-6">
            {steps.map(([number, title, text]) => <li key={number} className="flex gap-4"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-inset bg-primary-600 text-sm font-bold text-white shadow-glow">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted">{text}</p></div></li>)}
          </ol>
        </div>
      </section>

      {/* Action cards */}
      <section className="grid gap-5 md:grid-cols-2">
        <Link
          to="/create"
          className="card group cursor-pointer transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-raised dark:hover:border-primary-500/30"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary-100 rounded-inset group-hover:bg-primary-200 transition-colors">
              <PlusCircle className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">{t('home.cardCreateTitle')}</h3>
              <p className="text-sm text-muted">
                {t('home.cardCreateText')}
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/track"
          className="card group cursor-pointer transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-raised dark:hover:border-emerald-500/30"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-green-100 rounded-inset group-hover:bg-green-200 transition-colors">
              <Search className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">{t('home.cardTrackTitle')}</h3>
              <p className="text-sm text-muted">
                {t('home.cardTrackText')}
              </p>
            </div>
          </div>
        </Link>
      </section>

      {/* Features */}
      <section className="grid gap-6 rounded-overlay border border-white/50 bg-white/40 p-6 backdrop-blur-sm dark:border-slate-700/40 dark:bg-slate-900/30 md:grid-cols-3 sm:p-8">
        <div className="p-2">
          <Clock3 className="w-7 h-7 text-primary-500 mb-3" />
          <h4 className="font-semibold mb-1">{t('home.feature1Title')}</h4>
          <p className="text-sm text-muted">{t('home.feature1Text')}</p>
        </div>
        <div className="p-4">
          <Search className="w-7 h-7 text-primary-500 mb-3" />
          <h4 className="font-semibold mb-1">{t('home.feature2Title')}</h4>
          <p className="text-sm text-muted">{t('home.feature2Text')}</p>
        </div>
        <div className="p-4">
          <ShieldCheck className="w-7 h-7 text-primary-500 mb-3" />
          <h4 className="font-semibold mb-1">{t('home.feature3Title')}</h4>
          <p className="text-sm text-muted">{t('home.feature3Text')}</p>
        </div>
      </section>
    </div>
  );
}

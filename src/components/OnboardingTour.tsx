import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from '~/i18n';
import { trackEvent } from '~/store/analytics';

interface OnboardingTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

const TOTAL_STEPS = 5;

export default function OnboardingTour({ onComplete, onSkip }: OnboardingTourProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);

  // Entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      // Last step: complete
      trackEvent('onboarding_completed');
      localStorage.setItem('growimo_onboarding_completed', 'true');
      setVisible(false);
      setTimeout(() => onComplete(), 300);
    }
  }, [currentStep, onComplete]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    trackEvent('onboarding_skipped');
    localStorage.setItem('growimo_onboarding_skipped', 'true');
    setVisible(false);
    setTimeout(() => onSkip(), 300);
  }, [onSkip]);

  const handleStartProject = useCallback(() => {
    trackEvent('onboarding_completed');
    localStorage.setItem('growimo_onboarding_completed', 'true');
    setVisible(false);
    setTimeout(() => {
      onComplete();
      navigate({ to: '/app/new-project' });
    }, 300);
  }, [onComplete, navigate]);

  const steps = [
    {
      title: t.onboarding_welcome_title,
      text: t.onboarding_welcome_text,
      icon: (
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-3xl font-bold text-white shadow-lg">
          G
        </span>
      ),
    },
    {
      title: t.onboarding_step2_title,
      text: t.onboarding_step2_text,
      icon: <span className="text-5xl">📝</span>,
    },
    {
      title: t.onboarding_step3_title,
      text: t.onboarding_step3_text,
      icon: <span className="text-5xl">✨</span>,
    },
    {
      title: t.onboarding_step4_title,
      text: t.onboarding_step4_text,
      icon: <span className="text-5xl">🔍</span>,
    },
    {
      title: t.onboarding_step5_title,
      text: t.onboarding_step5_text,
      icon: <span className="text-5xl">🚀</span>,
    },
  ];

  const step = steps[currentStep];
  const isLastStep = currentStep === TOTAL_STEPS - 1;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm transition-all duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`mx-4 w-full max-w-lg transform transition-all duration-300 ${
          visible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        <div className="relative rounded-3xl border border-gray-200 bg-white shadow-2xl">
          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden rounded-t-3xl bg-gray-100">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 ease-out"
              style={{ width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>

          {/* Skip button */}
          <button
            type="button"
            onClick={handleSkip}
            className="absolute top-4 right-4 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
          >
            {t.onboarding_skip}
          </button>

          {/* Content */}
          <div className="px-8 pt-12 pb-6 text-center">
            <div className="mb-6 flex justify-center">{step.icon}</div>
            <h2 className="mb-3 text-xl font-extrabold text-gray-900">
              {step.title}
            </h2>
            <p className="text-sm leading-relaxed text-gray-500">{step.text}</p>
          </div>

          {/* Step indicators */}
          <div className="flex justify-center gap-2 pb-6">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  i < currentStep
                    ? 'bg-emerald-500'
                    : i === currentStep
                      ? 'bg-blue-600 scale-125'
                      : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between gap-3 rounded-b-3xl bg-gray-50 px-8 py-4">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 0}
              className={`text-sm font-medium transition-colors ${
                currentStep === 0
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.onboarding_back}
            </button>

            <span className="text-xs text-gray-400">
              {t.onboarding_step} {currentStep + 1}/{TOTAL_STEPS}
            </span>

            {isLastStep ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSkip}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-100"
                >
                  {t.onboarding_skip}
                </button>
                <button
                  type="button"
                  onClick={handleStartProject}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-lg hover:-translate-y-0.5"
                >
                  {t.onboarding_cta_start}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-lg hover:-translate-y-0.5"
              >
                {t.onboarding_next}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

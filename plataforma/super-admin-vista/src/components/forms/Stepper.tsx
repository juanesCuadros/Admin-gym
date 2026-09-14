import React from 'react';
import { Check } from 'lucide-react';

export interface StepItem {
  id: number;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: StepItem[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
  style?: React.CSSProperties;
}

export const Stepper: React.FC<StepperProps> = ({
  steps,
  currentStep,
  onStepClick,
  style,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '16px 0',
        marginBottom: '24px',
        ...style,
      }}
    >
      {steps.map((step, index) => {
        const isCompleted = step.id < currentStep;
        const isCurrent = step.id === currentStep;

        return (
          <React.Fragment key={step.id}>
            <div
              onClick={() => {
                if (isCompleted && onStepClick) {
                  onStepClick(step.id);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: isCompleted ? 'pointer' : 'default',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--font-weight-semibold)',
                  transition: 'all var(--transition-fast)',
                  backgroundColor: isCompleted
                    ? 'var(--color-success)'
                    : isCurrent
                    ? 'var(--color-action)'
                    : 'var(--color-bg-tertiary)',
                  color: isCompleted || isCurrent ? '#FFFFFF' : 'var(--color-text-secondary)',
                  boxShadow: isCurrent ? '0 0 0 4px var(--color-action-focus)' : 'none',
                }}
              >
                {isCompleted ? <Check size={16} strokeWidth={2.5} /> : step.id}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: isCurrent
                      ? 'var(--font-weight-semibold)'
                      : 'var(--font-weight-medium)',
                    color: isCurrent
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  {step.label}
                </div>
                {step.description && (
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-tertiary)',
                    }}
                  >
                    {step.description}
                  </div>
                )}
              </div>
            </div>

            {index < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: '2px',
                  margin: '0 16px',
                  backgroundColor: isCompleted
                    ? 'var(--color-success)'
                    : 'var(--color-border)',
                  transition: 'all var(--transition-fast)',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

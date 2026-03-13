export interface StepExecutor {
  description: string;
  execute: () => Promise<void>;
  verify?: {
    screenshot?: boolean;
    expectVisible?: string[];
    expectSelector?: string;
  };
  transition?: 'fade' | 'cut';
  speedUp?: number;
}

export interface ClipExecutor {
  clipId: number;
  steps: StepExecutor[];
}

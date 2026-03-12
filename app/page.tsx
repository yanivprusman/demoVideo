'use client';

import { useState, useCallback } from 'react';
import { clips, type ClipDefinition } from '@/lib/clips';

type ClipStatus = 'idle' | 'recording' | 'done' | 'error';

interface ClipState {
  status: ClipStatus;
  currentStep?: number;
  currentStepDesc?: string;
  filePath?: string;
  error?: string;
}

export default function Home() {
  const [clipStates, setClipStates] = useState<Record<number, ClipState>>({});
  const [expandedClips, setExpandedClips] = useState<Set<number>>(new Set([1]));
  const [allExpanded, setAllExpanded] = useState(false);

  const toggleExpand = useCallback((id: number) => {
    setExpandedClips(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedClips(new Set());
    } else {
      setExpandedClips(new Set(clips.map(c => c.id)));
    }
    setAllExpanded(!allExpanded);
  }, [allExpanded]);

  const recordClip = useCallback(async (clipId: number) => {
    setClipStates(prev => ({
      ...prev,
      [clipId]: { status: 'recording', currentStep: 0, currentStepDesc: 'Starting...' },
    }));

    try {
      const response = await fetch('/api/record-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === 'step') {
            setClipStates(prev => ({
              ...prev,
              [clipId]: {
                status: 'recording',
                currentStep: data.step,
                currentStepDesc: data.description,
              },
            }));
          } else if (data.type === 'done') {
            setClipStates(prev => ({
              ...prev,
              [clipId]: { status: 'done', filePath: data.filePath },
            }));
          } else if (data.type === 'error') {
            setClipStates(prev => ({
              ...prev,
              [clipId]: { status: 'error', error: data.message },
            }));
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setClipStates(prev => ({
        ...prev,
        [clipId]: { status: 'error', error: message },
      }));
    }
  }, []);

  const doneCount = Object.values(clipStates).filter(s => s.status === 'done').length;
  const recordingClip = Object.entries(clipStates).find(([, s]) => s.status === 'recording');

  return (
    <div className="min-h-screen p-6 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Demo Video Recorder</h1>
          <p className="text-gray-500 text-sm mt-1">
            {doneCount}/20 clips recorded
            {recordingClip && (
              <span className="ml-3 text-amber-400 animate-pulse">
                Recording clip {recordingClip[0]}...
              </span>
            )}
          </p>
        </div>
        <button
          onClick={toggleAll}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Clip Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {clips.map(clip => (
          <ClipCard
            key={clip.id}
            clip={clip}
            state={clipStates[clip.id] || { status: 'idle' }}
            isExpanded={expandedClips.has(clip.id)}
            onToggle={() => toggleExpand(clip.id)}
            onRecord={() => recordClip(clip.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ClipCard({
  clip,
  state,
  isExpanded,
  onToggle,
  onRecord,
}: {
  clip: ClipDefinition;
  state: ClipState;
  isExpanded: boolean;
  onToggle: () => void;
  onRecord: () => void;
}) {
  return (
    <div className={`rounded-lg border ${borderColor(state.status)} bg-gray-900 overflow-hidden transition-colors`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
      >
        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${numberStyle(clip, state)}`}>
          {clip.id}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{clip.title}</h3>
            <StatusBadge status={state.status} step={state.currentStep} total={clip.recordingSteps.length} />
          </div>
          <div className="flex gap-1 mt-1 flex-wrap">
            {clip.features.map((f, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{f}</span>
            ))}
          </div>
        </div>
        <span className="text-gray-600 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-800/50">
          <Section title="Pre-state" items={clip.preState} color="blue" />
          <Section
            title="Recording Steps"
            items={clip.recordingSteps}
            color="amber"
            numbered
            currentStep={state.status === 'recording' ? state.currentStep : undefined}
          />
          <Section title="Post-state" items={clip.postState} color="green" />

          {/* Status messages */}
          {state.status === 'recording' && state.currentStepDesc && (
            <p className="text-amber-400 text-xs animate-pulse pt-1">{state.currentStepDesc}</p>
          )}
          {state.status === 'error' && (
            <p className="text-red-400 text-xs pt-1">{state.error}</p>
          )}
          {state.status === 'done' && state.filePath && (
            <p className="text-green-400 text-xs pt-1">Saved: {state.filePath}</p>
          )}

          {/* Action button */}
          <button
            onClick={(e) => { e.stopPropagation(); onRecord(); }}
            disabled={!clip.enabled || state.status === 'recording'}
            className={`w-full py-2 rounded-lg font-medium text-sm transition-colors mt-1 ${buttonStyle(clip, state)}`}
          >
            {buttonLabel(state)}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, step, total }: { status: ClipStatus; step?: number; total: number }) {
  if (status === 'recording') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">{step}/{total}</span>;
  }
  if (status === 'done') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">Done</span>;
  }
  if (status === 'error') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">Error</span>;
  }
  return null;
}

function Section({
  title,
  items,
  color,
  numbered,
  currentStep,
}: {
  title: string;
  items: string[];
  color: 'blue' | 'amber' | 'green';
  numbered?: boolean;
  currentStep?: number;
}) {
  const labelColor = {
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    green: 'text-green-400',
  }[color];

  return (
    <div className="pt-2">
      <h4 className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${labelColor}`}>
        {title}
      </h4>
      <ul className="space-y-0.5">
        {items.map((item, i) => {
          const stepNum = i + 1;
          const isActive = currentStep !== undefined && stepNum === currentStep;
          const isPast = currentStep !== undefined && stepNum < currentStep;
          return (
            <li
              key={i}
              className={`text-xs leading-relaxed ${
                isActive ? 'text-amber-300 font-medium' :
                isPast ? 'text-gray-600 line-through' :
                'text-gray-400'
              }`}
            >
              <span className="text-gray-600 mr-1.5 inline-block w-4 text-right">
                {numbered ? `${stepNum}.` : '\u2022'}
              </span>
              {item}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function borderColor(status: ClipStatus) {
  switch (status) {
    case 'recording': return 'border-amber-500/50';
    case 'done': return 'border-green-500/30';
    case 'error': return 'border-red-500/30';
    default: return 'border-gray-800';
  }
}

function numberStyle(clip: ClipDefinition, state: ClipState) {
  if (state.status === 'recording') return 'bg-amber-500 text-black';
  if (state.status === 'done') return 'bg-green-600 text-white';
  if (state.status === 'error') return 'bg-red-600 text-white';
  if (clip.enabled) return 'bg-blue-600 text-white';
  return 'bg-gray-800 text-gray-500';
}

function buttonStyle(clip: ClipDefinition, state: ClipState) {
  if (state.status === 'recording') return 'bg-amber-500/20 text-amber-400 cursor-wait';
  if (!clip.enabled) return 'bg-gray-800 text-gray-600 cursor-not-allowed';
  if (state.status === 'done') return 'bg-blue-600 hover:bg-blue-500 text-white';
  if (state.status === 'error') return 'bg-red-600 hover:bg-red-500 text-white';
  return 'bg-green-600 hover:bg-green-500 text-white';
}

function buttonLabel(state: ClipState) {
  switch (state.status) {
    case 'recording': return 'Recording...';
    case 'done': return 'Re-record';
    case 'error': return 'Retry';
    default: return 'Record';
  }
}

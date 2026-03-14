'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { clips, type ClipDefinition } from '@/lib/clips';

type ClipStatus = 'idle' | 'recording' | 'done' | 'error';

interface ClipState {
  status: ClipStatus;
  currentStep?: number;
  currentStepDesc?: string;
  filePath?: string;
  error?: string;
  showVideo?: boolean;
  recordingStartedAt?: number;
  productionTimeSecs?: number;
  mode?: 'segment' | 'legacy';
  segmentSteps?: number; // total steps for segment mode
  videoVersion?: number; // cache-busting counter for re-stitched videos
  postProd?: {
    segments: number;
    mouseLogs: number;
    keyframes: number;
    status?: 'generating' | 'stitching' | 'done' | 'error';
    message?: string;
  };
}

interface VideoFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export default function Home() {
  const [clipStates, setClipStates] = useState<Record<number, ClipState>>({});
  const [expandedClips, setExpandedClips] = useState<Set<number>>(new Set([1]));
  const [allExpanded, setAllExpanded] = useState(false);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [showVideos, setShowVideos] = useState(false);

  // Subscribe to broadcast SSE for live updates from any device
  useEffect(() => {
    const es = new EventSource('/api/recording-status');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const id = data.clipId as number;
        if (!id) return;

        if (data.type === 'step') {
          setClipStates(prev => ({
            ...prev,
            [id]: {
              ...prev[id],
              status: 'recording',
              currentStep: data.step,
              currentStepDesc: data.description,
              ...(data.mode ? { mode: data.mode } : {}),
              ...(data.segmentSteps ? { segmentSteps: data.segmentSteps } : {}),
            },
          }));
        } else if (data.type === 'done') {
          setClipStates(prev => {
            const prevState = prev[id];
            const productionTimeSecs = prevState?.recordingStartedAt
              ? Math.round((Date.now() - prevState.recordingStartedAt) / 1000)
              : undefined;
            return { ...prev, [id]: { status: 'done', filePath: data.filePath, productionTimeSecs } };
          });
        } else if (data.type === 'error') {
          setClipStates(prev => ({
            ...prev,
            [id]: { ...prev[id], status: 'error', error: data.message },
          }));
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    fetch('/api/videos')
      .then(r => r.json())
      .then(setVideos)
      .catch(() => {});

    // Check which clips have existing recordings on disk
    const pathsToCheck: Record<string, string> = {};
    for (const clip of clips) {
      if (clip.outputPath) {
        pathsToCheck[String(clip.id)] = clip.outputPath;
      }
    }
    if (Object.keys(pathsToCheck).length > 0) {
      fetch('/api/check-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: pathsToCheck }),
      })
        .then(r => r.json())
        .then((results: Record<string, { exists: boolean; path: string }>) => {
          setClipStates(prev => {
            const next = { ...prev };
            for (const [clipId, info] of Object.entries(results)) {
              const id = Number(clipId);
              if (info.exists) {
                if (!next[id] || next[id].status === 'idle') {
                  next[id] = { status: 'done', filePath: info.path };
                } else {
                  next[id] = { ...next[id], filePath: info.path };
                }
              }
            }
            return next;
          });
        })
        .catch(() => {});
    }
  }, []);

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
      [clipId]: { status: 'recording', currentStepDesc: 'Starting...', recordingStartedAt: Date.now() },
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
                ...prev[clipId],
                status: 'recording',
                currentStep: data.step,
                currentStepDesc: data.description,
              },
            }));
          } else if (data.type === 'done') {
            setClipStates(prev => {
              const prevState = prev[clipId];
              const productionTimeSecs = prevState?.recordingStartedAt
                ? Math.round((Date.now() - prevState.recordingStartedAt) / 1000)
                : undefined;
              return { ...prev, [clipId]: { status: 'done', filePath: data.filePath, productionTimeSecs } };
            });
          } else if (data.type === 'error') {
            setClipStates(prev => ({
              ...prev,
              [clipId]: { ...prev[clipId], status: 'error', error: data.message },
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

  const stopRecording = useCallback(async (clipId: number) => {
    try {
      await fetch('/api/stop-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });
    } catch { /* ignore */ }
  }, []);

  const toggleVideo = useCallback((clipId: number) => {
    setClipStates(prev => ({
      ...prev,
      [clipId]: {
        ...prev[clipId],
        showVideo: !prev[clipId]?.showVideo,
      },
    }));
  }, []);

  const fetchSegmentInfo = useCallback(async (clipId: number) => {
    try {
      const r = await fetch(`/api/segment-info?clipId=${clipId}`);
      const data = await r.json();
      setClipStates(prev => ({
        ...prev,
        [clipId]: {
          ...prev[clipId],
          postProd: { ...prev[clipId]?.postProd, segments: data.segments, mouseLogs: data.mouseLogs, keyframes: data.keyframes, status: prev[clipId]?.postProd?.status, message: prev[clipId]?.postProd?.message },
        },
      }));
    } catch { /* ignore */ }
  }, []);

  const generateKeyframes = useCallback(async (clipId: number) => {
    setClipStates(prev => ({
      ...prev,
      [clipId]: { ...prev[clipId], postProd: { ...prev[clipId]?.postProd!, status: 'generating', message: 'Generating keyframes...' } },
    }));
    try {
      const r = await fetch('/api/generate-keyframes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      const totalKf = (data.generated as { keyframeCount: number }[]).reduce((s, g) => s + g.keyframeCount, 0);
      setClipStates(prev => ({
        ...prev,
        [clipId]: { ...prev[clipId], postProd: { ...prev[clipId]?.postProd!, status: 'done', message: `Generated ${totalKf} keyframes across ${data.generated.length} segments` } },
      }));
      // Refresh counts
      await fetchSegmentInfo(clipId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setClipStates(prev => ({
        ...prev,
        [clipId]: { ...prev[clipId], postProd: { ...prev[clipId]?.postProd!, status: 'error', message } },
      }));
    }
  }, [fetchSegmentInfo]);

  const reStitch = useCallback(async (clipId: number) => {
    setClipStates(prev => ({
      ...prev,
      [clipId]: { ...prev[clipId], postProd: { ...prev[clipId]?.postProd!, status: 'stitching', message: 'Re-stitching with zoom...' } },
    }));
    try {
      const r = await fetch('/api/stitch-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setClipStates(prev => ({
        ...prev,
        [clipId]: { ...prev[clipId], filePath: data.filePath, videoVersion: (prev[clipId]?.videoVersion || 0) + 1, postProd: { ...prev[clipId]?.postProd!, status: 'done', message: `Stitched ${data.segmentCount} segments` } },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setClipStates(prev => ({
        ...prev,
        [clipId]: { ...prev[clipId], postProd: { ...prev[clipId]?.postProd!, status: 'error', message } },
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
            {doneCount}/{clips.length} clips recorded
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

      {/* Videos Section */}
      <div className="mb-6">
        <button
          onClick={() => setShowVideos(!showVideos)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 transition-colors border border-purple-800/30"
        >
          <span>{showVideos ? '\u25B2' : '\u25BC'}</span>
          Recorded Videos ({videos.length})
        </button>

        {showVideos && (
          <div className="mt-3 space-y-2">
            {videos.length === 0 && (
              <p className="text-gray-500 text-sm">No recorded videos found.</p>
            )}
            {videos.map(v => (
              <div key={v.path} className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
                <div
                  className="flex items-center gap-3 p-2 cursor-pointer hover:bg-gray-800/50 transition-colors"
                  onClick={() => setActiveVideo(activeVideo === v.path ? null : v.path)}
                >
                  <span className={`text-xs px-2 py-0.5 rounded ${activeVideo === v.path ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                    {activeVideo === v.path ? 'Hide' : 'Watch'}
                  </span>
                  <span className="text-sm text-gray-200 flex-1 truncate">{v.name}</span>
                  <span className="text-xs text-gray-500">{formatSize(v.size)}</span>
                  <span className="text-xs text-gray-600">{new Date(v.modified).toLocaleDateString()}</span>
                </div>
                {activeVideo === v.path && (
                  <div className="px-2 pb-2">
                    <video
                      key={v.path}
                      controls
                      className="w-full rounded-lg border border-gray-700"
                      src={`/api/video?path=${encodeURIComponent(v.path)}`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
            onStop={() => stopRecording(clip.id)}
            onToggleVideo={() => toggleVideo(clip.id)}
            onFetchSegmentInfo={() => fetchSegmentInfo(clip.id)}
            onGenerateKeyframes={() => generateKeyframes(clip.id)}
            onReStitch={() => reStitch(clip.id)}
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
  onStop,
  onToggleVideo,
  onFetchSegmentInfo,
  onGenerateKeyframes,
  onReStitch,
}: {
  clip: ClipDefinition;
  state: ClipState;
  isExpanded: boolean;
  onToggle: () => void;
  onRecord: () => void;
  onStop: () => void;
  onToggleVideo: () => void;
  onFetchSegmentInfo: () => void;
  onGenerateKeyframes: () => void;
  onReStitch: () => void;
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
            <StatusBadge status={state.status} step={state.currentStep} total={clip.recordingSteps.length} mode={state.mode} segmentSteps={state.segmentSteps} />
          </div>
          <div className="flex gap-1 mt-1 flex-wrap">
            {clip.features.map((f, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{f}</span>
            ))}
          </div>
        </div>
        {state.filePath && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleVideo(); }}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              state.showVideo
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            {state.showVideo ? 'Hide' : 'Watch'}
          </button>
        )}
        <span className="text-gray-600 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Video player - outside expanded section so it's always accessible */}
      {state.showVideo && state.filePath && (
        <div className="px-3 pb-2">
          <video
            key={`${state.filePath}-${state.videoVersion || 0}`}
            controls
            className="w-full rounded-lg border border-gray-700"
            src={`/api/video?path=${encodeURIComponent(state.filePath)}&v=${state.videoVersion || 0}`}
          />
        </div>
      )}

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
          {state.status === 'recording' && (
            <div className="pt-1 space-y-1">
              <p className="text-amber-400 text-xs animate-pulse">
                {state.currentStepDesc || 'Claude is working...'}
              </p>
              <ElapsedTimer startedAt={state.recordingStartedAt} />
            </div>
          )}
          {state.status === 'error' && (
            <p className="text-red-400 text-xs pt-1">{state.error}</p>
          )}
          {state.status === 'done' && state.filePath && (
            <div className="pt-1">
              <p className="text-green-400 text-xs truncate">
                Saved: {state.filePath}
                {state.productionTimeSecs != null && (
                  <span className="text-gray-500 ml-2">
                    ({formatDuration(state.productionTimeSecs)})
                  </span>
                )}
              </p>
            </div>
          )}

          {state.status === 'done' && (
            <PostProduction
              postProd={state.postProd}
              onFetchInfo={onFetchSegmentInfo}
              onGenerateKeyframes={onGenerateKeyframes}
              onReStitch={onReStitch}
            />
          )}

          {/* Action button */}
          {state.status === 'recording' ? (
            <button
              onClick={(e) => { e.stopPropagation(); onStop(); }}
              className="w-full py-2 rounded-lg font-medium text-sm transition-colors mt-1 bg-red-600 hover:bg-red-500 text-white"
            >
              Stop Recording
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onRecord(); }}
              disabled={!clip.enabled}
              className={`w-full py-2 rounded-lg font-medium text-sm transition-colors mt-1 ${buttonStyle(clip, state)}`}
            >
              {buttonLabel(state)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt?: number }) {
  const [elapsed, setElapsed] = useState('0:00');
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setElapsed(`${m}:${s.toString().padStart(2, '0')}`);
    };
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => clearInterval(intervalRef.current);
  }, [startedAt]);

  return (
    <p className="text-gray-500 text-[10px]">
      Elapsed: {elapsed}
    </p>
  );
}

function PostProduction({
  postProd,
  onFetchInfo,
  onGenerateKeyframes,
  onReStitch,
}: {
  postProd?: ClipState['postProd'];
  onFetchInfo: () => void;
  onGenerateKeyframes: () => void;
  onReStitch: () => void;
}) {
  const fetched = useRef(false);
  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      onFetchInfo();
    }
  }, [onFetchInfo]);

  const busy = postProd?.status === 'generating' || postProd?.status === 'stitching';

  return (
    <div className="mt-2 rounded-lg border border-gray-700/50 bg-gray-800/30 p-2.5 space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">Post-Production</h4>

      {postProd && postProd.segments > 0 ? (
        <>
          <div className="flex gap-4 text-xs text-gray-400">
            <span>Segments: <span className="text-gray-200">{postProd.segments}</span></span>
            <span>Mouse logs: <span className={postProd.mouseLogs > 0 ? 'text-gray-200' : 'text-gray-600'}>{postProd.mouseLogs}</span></span>
            <span>Keyframes: <span className={postProd.keyframes > 0 ? 'text-purple-300' : 'text-gray-600'}>{postProd.keyframes}</span></span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateKeyframes(); }}
              disabled={busy || postProd.mouseLogs === 0}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                busy || postProd.mouseLogs === 0
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-500 text-white'
              }`}
            >
              Generate Keyframes
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReStitch(); }}
              disabled={busy}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                busy
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              Re-stitch
            </button>
          </div>

          {postProd.message && (
            <p className={`text-xs ${
              postProd.status === 'error' ? 'text-red-400' :
              postProd.status === 'generating' || postProd.status === 'stitching' ? 'text-amber-400 animate-pulse' :
              'text-gray-400'
            }`}>
              {postProd.message}
            </p>
          )}
        </>
      ) : postProd ? (
        <p className="text-xs text-gray-600">No segments found for this clip.</p>
      ) : (
        <p className="text-xs text-gray-600 animate-pulse">Loading segment info...</p>
      )}
    </div>
  );
}

function StatusBadge({ status, step, total, mode, segmentSteps }: { status: ClipStatus; step?: number; total: number; mode?: string; segmentSteps?: number }) {
  if (status === 'recording') {
    if (mode === 'segment' && segmentSteps) {
      // Show per-step dots for segment mode
      return (
        <span className="flex items-center gap-0.5">
          {Array.from({ length: segmentSteps }, (_, i) => {
            const stepNum = i + 1;
            const isDone = step !== undefined && stepNum <= step;
            const isActive = step !== undefined && stepNum === step + 1;
            return (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${
                  isDone ? 'bg-green-400' :
                  isActive ? 'bg-amber-400 animate-pulse' :
                  'bg-gray-600'
                }`}
              />
            );
          })}
        </span>
      );
    }
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">{step !== undefined ? `${step}/${total}` : 'Claude...'}</span>;
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

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

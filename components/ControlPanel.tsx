
import React, { useRef } from 'react';
import { ImageIcon, Clock, Type, Crop, AlignLeft, AlignCenter, AlignRight, Zap, MousePointer2 } from 'lucide-react';
import { AppState, TimingConfig, MediaSlotData, TypographyConfig, AnimationConfig } from '../types';
import { FONTS, TIMING_LABELS } from '../constants';

interface MediaCropSelectorProps {
  url: string | null;
  type: 'image' | 'video';
  xOffset: number;
  aspectRatio?: number;
  onChange: (val: number) => void;
}

/**
 * Visual Crop Selector Component
 * Optimized for high contrast and precise alignment
 */
const MediaCropSelector: React.FC<MediaCropSelectorProps> = ({ url, type, xOffset, aspectRatio = 1.777, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleUpdate = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const width = rect.width;
    
    // The mask width is always 1/3 of a 16:9 container (which is what the selector displays)
    const maskWidth = width / 3;
    
    // However, the image itself might not be 16:9.
    // We want to know how much horizontal overflow there is when the image covers the panel.
    const panelAspect = (1920/3) / 1080;
    const imageAspect = aspectRatio;
    
    if (imageAspect <= panelAspect) {
      // No horizontal overflow, panning is disabled or useless
      onChange(50);
      return;
    }

    const maxMove = width - maskWidth;
    let newLeft = x - (maskWidth / 2);
    newLeft = Math.max(0, Math.min(newLeft, maxMove));
    const percentage = (newLeft / maxMove) * 100;
    onChange(Math.round(percentage));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleUpdate(e.clientX);
    const moveHandler = (moveEvent: MouseEvent) => handleUpdate(moveEvent.clientX);
    const upHandler = () => {
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
    };
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
  };

  return (
    <div 
      ref={containerRef}
      onMouseDown={onMouseDown}
      className="relative aspect-video w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800 cursor-ew-resize group select-none"
    >
      {url ? (
        <>
          {/* Base Layer: Dimmed background */}
          <div className="absolute inset-0 z-0">
            {type === 'image' ? (
              <img 
                src={url} 
                className="w-full h-full object-cover opacity-10 grayscale pointer-events-none" 
                alt="Reference" 
              />
            ) : (
              <video 
                src={url} 
                className="w-full h-full object-cover opacity-10 grayscale pointer-events-none" 
              />
            )}
          </div>
          
          {/* Active Mask: The 1/3 window */}
          <div 
            className="absolute top-0 bottom-0 z-10 border-x border-blue-500 shadow-[0_0_50px_rgba(0,0,0,0.8)] pointer-events-none"
            style={{ 
              width: '33.333%', 
              left: `${xOffset * (2/3)}%` 
            }}
          >
            {/* Inner High-Resolution Clip */}
            <div className="w-full h-full overflow-hidden relative bg-black/20">
              {type === 'image' ? (
                <img 
                  src={url} 
                  className="absolute inset-0 w-full h-full object-cover" 
                  style={{
                    objectPosition: `${xOffset}% center`
                  }} 
                />
              ) : (
                <video 
                  src={url} 
                  className="absolute inset-0 w-full h-full object-cover" 
                  style={{
                    objectPosition: `${xOffset}% center`
                  }} 
                />
              )}
            </div>
            
            {/* Guides Layer - Isolated for clarity */}
            <div className="absolute inset-0 z-20 pointer-events-none opacity-30">
               <div className="absolute top-1/3 left-0 w-full h-px border-t border-dashed border-white"></div>
               <div className="absolute top-2/3 left-0 w-full h-px border-t border-dashed border-white"></div>
            </div>

            {/* High Contrast Label - Outside internal clip but inside mask container */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center justify-center w-full px-2">
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 rounded shadow-[0_4px_10px_rgba(0,0,0,0.4)] backdrop-blur-md">
                  <MousePointer2 className="w-2.5 h-2.5 text-white fill-current" />
                  <span className="text-[9px] font-black text-white tracking-[0.1em] uppercase">Selected</span>
                </div>
                <div className="px-1.5 py-0.5 bg-slate-900/80 rounded text-[7px] font-bold text-slate-400 uppercase tracking-tighter">
                  Ratio: {aspectRatio > 1 ? '16:9' : '9:16'} ({aspectRatio.toFixed(2)})
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-700 gap-2">
           <ImageIcon className="w-8 h-8 opacity-20" />
           <span className="text-[10px] font-bold uppercase tracking-widest">No Asset Loaded</span>
        </div>
      )}
    </div>
  );
};

interface ControlPanelProps {
  state: AppState;
  onUpdateSlots: (slotId: keyof AppState['slots'], data: Partial<MediaSlotData>) => void;
  onUpdateTiming: (timing: Partial<TimingConfig>) => void;
  onUpdateTypography: (typography: Partial<TypographyConfig>) => void;
  onUpdateAnimation: (animation: Partial<AnimationConfig>) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  state, 
  onUpdateSlots, 
  onUpdateTiming, 
  onUpdateTypography,
  onUpdateAnimation
}) => {
  return (
    <div className="flex flex-col gap-10 p-6">
      {/* Asset Management */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon className="w-4 h-4 text-blue-400" />
          <h3 className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Composition Assets</h3>
        </div>
        <div className="grid grid-cols-1 gap-8">
          {(['a', 'b', 'c', 'd'] as const).map(slotId => (
            <div key={slotId} className="flex flex-col gap-3 group/slot">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-tight flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${slotId === 'a' ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'}`} />
                  {slotId === 'a' ? 'Intro Background (16:9)' : `Panel ${slotId.toUpperCase()} Composition`}
                </span>
                <input 
                  type="file" 
                  id={`file-${slotId}`} 
                  className="hidden" 
                  accept="image/*,video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const url = URL.createObjectURL(file);
                      const type = file.type.startsWith('video') ? 'video' : 'image';
                      
                      if (type === 'image') {
                        const img = new Image();
                        img.onload = () => {
                          onUpdateSlots(slotId, { 
                            url, 
                            type,
                            aspectRatio: img.width / img.height,
                            startTime: 0
                          });
                        };
                        img.src = url;
                      } else {
                        const video = document.createElement('video');
                        video.onloadedmetadata = () => {
                          onUpdateSlots(slotId, {
                            url,
                            type,
                            aspectRatio: video.videoWidth / video.videoHeight,
                            startTime: 0,
                            endTime: video.duration
                          });
                        };
                        video.src = url;
                      }
                    }
                  }}
                />
                <label 
                  htmlFor={`file-${slotId}`} 
                  className="text-[9px] font-bold uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-lg cursor-pointer transition-all active:scale-95"
                >
                  Replace
                </label>
              </div>

              {slotId === 'a' ? (
                <div className="aspect-video w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800 relative shadow-inner">
                  {state.slots.a.url ? (
                    state.slots.a.type === 'image' ? (
                      <img src={state.slots.a.url} className="w-full h-full object-cover" alt="Intro" />
                    ) : (
                      <video src={state.slots.a.url} className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-slate-800" /></div>
                  )}
                </div>
              ) : (
                <MediaCropSelector 
                  url={state.slots[slotId].url}
                  type={state.slots[slotId].type}
                  xOffset={state.slots[slotId].xOffset}
                  aspectRatio={state.slots[slotId].aspectRatio}
                  onChange={(val) => onUpdateSlots(slotId, { xOffset: val })}
                />
              )}

              {state.slots[slotId].type === 'video' && (
                <div className="flex flex-col gap-3 mt-1 bg-slate-800/20 p-3 rounded-xl border border-slate-800/50">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Start Time</label>
                      <span className="text-[10px] font-mono text-blue-400 font-bold">{state.slots[slotId].startTime.toFixed(1)}s</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" max={state.slots[slotId].endTime || 60} step="0.1"
                      value={state.slots[slotId].startTime} 
                      onChange={(e) => onUpdateSlots(slotId, { startTime: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">End Time</label>
                      <span className="text-[10px] font-mono text-rose-400 font-bold">{(state.slots[slotId].endTime || 0).toFixed(1)}s</span>
                    </div>
                    <input 
                      type="range" 
                      min={state.slots[slotId].startTime} max={120} step="0.1"
                      value={state.slots[slotId].endTime || 0} 
                      onChange={(e) => onUpdateSlots(slotId, { endTime: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500" 
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Timing Configuration */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-blue-400" />
          <h3 className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Timeline Engine</h3>
        </div>
        <div className="flex flex-col gap-6 bg-slate-800/20 p-5 rounded-2xl border border-slate-800/50 shadow-inner">
          <div className="grid grid-cols-1 gap-y-4">
            {Object.entries(state.timing).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase whitespace-nowrap tracking-tighter">
                  {TIMING_LABELS[key]}
                </label>
                <div className="flex items-center gap-2">
                   <input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    value={value as number} 
                    onChange={(e) => onUpdateTiming({ [key]: parseFloat(e.target.value) || 0 })}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-600 transition-colors font-mono w-20 text-right text-blue-400 shadow-sm"
                  />
                  <span className="text-[9px] text-slate-600 font-black">S</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-800/50">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] text-slate-400 uppercase font-black flex items-center gap-2 tracking-widest">
                <Zap className="w-3 h-3 text-yellow-500 fill-yellow-500/20" /> Energy Scale
              </span>
              <span className="text-xs font-mono text-blue-400 font-bold">x{state.animation.bounceScale.toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="1.0" max="1.3" step="0.01"
              value={state.animation.bounceScale} 
              onChange={(e) => onUpdateAnimation({ bounceScale: parseFloat(e.target.value) })}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" 
            />
          </div>
        </div>
      </section>

      {/* Typography Styling */}
      <section className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          <Type className="w-4 h-4 text-blue-400" />
          <h3 className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Typography</h3>
        </div>
        <div className="flex flex-col gap-4">
          <textarea 
            rows={3}
            placeholder="Enter brand message..."
            value={state.typography.content} 
            onChange={(e) => onUpdateTypography({ content: e.target.value })}
            className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-colors w-full resize-none shadow-inner text-slate-200 placeholder:text-slate-700"
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Font Family</label>
              <select 
                value={state.typography.fontFamily} 
                onChange={(e) => onUpdateTypography({ fontFamily: e.target.value })}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-600 transition-colors appearance-none cursor-pointer"
              >
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Base Size</label>
              <input 
                type="number" 
                value={state.typography.fontSize} 
                onChange={(e) => onUpdateTypography({ fontSize: parseInt(e.target.value) || 0 })}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-600 transition-colors font-mono"
              />
            </div>
          </div>

          <div className="flex justify-between items-end gap-4">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Color Hex</label>
              <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
                 <input 
                  type="color" 
                  value={state.typography.color} 
                  onChange={(e) => onUpdateTypography({ color: e.target.value })}
                  className="w-6 h-6 bg-transparent border-none rounded-md cursor-pointer overflow-hidden shadow-sm"
                />
                <span className="text-[10px] font-mono uppercase text-slate-500 font-bold">{state.typography.color}</span>
              </div>
            </div>
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl overflow-hidden p-1 shadow-sm">
               {(['left', 'center', 'right'] as const).map(align => (
                 <button 
                  key={align}
                  onClick={() => onUpdateTypography({ align })}
                  className={`p-2 rounded-lg transition-all ${state.typography.align === align ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-800'}`}
                 >
                   {align === 'left' ? <AlignLeft className="w-4 h-4" /> : align === 'center' ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
                 </button>
               ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ControlPanel;

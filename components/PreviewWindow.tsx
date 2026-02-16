
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppState } from '../types';

interface PreviewWindowProps {
  state: AppState;
  isPlaying: boolean;
  onComplete: () => void;
}

const PreviewWindow: React.FC<PreviewWindowProps> = ({ state, isPlaying, onComplete }) => {
  const { timing, slots, typography, animation } = state;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isPlaying) {
      setStep(0);
      return;
    }

    const runSequence = async () => {
      setStep(1); // Intro
      await new Promise(r => setTimeout(r, timing.t1 * 1000));
      setStep(2); // Fade
      await new Promise(r => setTimeout(r, timing.t2 * 1000));
      setStep(3); // Entry
      await new Promise(r => setTimeout(r, timing.t3 * 1000));
      setStep(4); // Bounce
      await new Promise(r => setTimeout(r, timing.t4 * 1000));
      setStep(5); // Overlay
      await new Promise(r => setTimeout(r, timing.t5 * 1000));
      setStep(6); // Outro
      await new Promise(r => setTimeout(r, timing.t6 * 1000));
      onComplete();
    };

    runSequence();
  }, [isPlaying, timing]);

  const getPanStyle = (offset: number) => ({
    objectPosition: `${offset}% center`,
  });

  return (
    <div className="w-full h-full relative bg-black overflow-hidden select-none">
      {/* STEP 1 & 2: INTRO */}
      <AnimatePresence>
        {(step === 1 || step === 2) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: step === 2 ? 0 : 1, scale: 1.05 }}
            exit={{ opacity: 0 }}
            transition={{ 
              opacity: { duration: step === 2 ? timing.t2 : 0.3 },
              scale: { duration: timing.t1 + timing.t2, ease: "linear" }
            }}
            className="absolute inset-0 z-10"
          >
            {slots.a.url && <img src={slots.a.url} className="w-full h-full object-cover" crossOrigin="anonymous" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* STEP 3 - 6: COLLAGE */}
      {step >= 3 && (
        <div className="absolute inset-0 flex z-0">
          <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} transition={{ duration: timing.t3 }} className="flex-1 h-full overflow-hidden border-r border-black relative">
            <motion.img 
              animate={step === 4 ? { scale: [1, animation.bounceScale, 1] } : {}}
              transition={{ duration: timing.t4 / 3, ease: "easeInOut" }}
              src={slots.b.url || ''} className="absolute inset-0 w-full h-full object-cover" style={getPanStyle(slots.b.xOffset)} crossOrigin="anonymous"
            />
          </motion.div>
          <motion.div initial={{ y: "-100%" }} animate={{ y: 0 }} transition={{ duration: timing.t3, delay: 0.1 }} className="flex-1 h-full overflow-hidden border-r border-black relative">
            <motion.img 
              animate={step === 4 ? { scale: [1, animation.bounceScale, 1] } : {}}
              transition={{ duration: timing.t4 / 3, delay: timing.t4 / 3, ease: "easeInOut" }}
              src={slots.c.url || ''} className="absolute inset-0 w-full h-full object-cover" style={getPanStyle(slots.c.xOffset)} crossOrigin="anonymous"
            />
          </motion.div>
          <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ duration: timing.t3, delay: 0.2 }} className="flex-1 h-full overflow-hidden relative">
            <motion.img 
              animate={step === 4 ? { scale: [1, animation.bounceScale, 1] } : {}}
              transition={{ duration: timing.t4 / 3, delay: (timing.t4 / 3) * 2, ease: "easeInOut" }}
              src={slots.d.url || ''} className="absolute inset-0 w-full h-full object-cover" style={getPanStyle(slots.d.xOffset)} crossOrigin="anonymous"
            />
          </motion.div>
        </div>
      )}

      {/* STEP 5 & 6: OVERLAY */}
      <AnimatePresence>
        {step >= 5 && (
          <motion.div 
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(20px)" }}
            transition={{ duration: timing.t5 }}
            className="absolute inset-0 z-20 flex items-center justify-center p-20 bg-black/40"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: timing.t5 }}
              className="w-full font-bold"
              style={{
                textAlign: typography.align,
                fontFamily: typography.fontFamily,
                color: typography.color,
                fontSize: `${typography.fontSize}px`,
                textShadow: "0 10px 40px rgba(0,0,0,0.8)"
              }}
            >
              {typography.content.split('\n').map((l, i) => <div key={i}>{l}</div>)}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isPlaying && step === 0 && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
           <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl shadow-2xl text-center">
             <div className="text-blue-400 font-bold mb-1">PREVIEW READY</div>
             <div className="text-slate-500 text-xs">Settings will be applied to the final WebM render</div>
           </div>
        </div>
      )}
    </div>
  );
};

export default PreviewWindow;

import React from 'react';
import { createRoot } from 'react-dom/client';
import FirstChapter from '../../client/src/game/chapters/firstChapter/FirstChapter';
// Local standalone harness. No authentication bypass or synthetic business feed.
createRoot(document.getElementById('root')!).render(<FirstChapter />);

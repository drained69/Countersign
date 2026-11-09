import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { DURATION_FRAMES, FPS } from "./timeline";

export const Root: React.FC = () => (
  <>
    <Composition id="Wide" component={Video} durationInFrames={DURATION_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{ layout: "wide" as const }} />
    <Composition id="Tall" component={Video} durationInFrames={DURATION_FRAMES} fps={FPS} width={1080} height={1920} defaultProps={{ layout: "tall" as const }} />
  </>
);

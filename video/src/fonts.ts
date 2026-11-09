// Geist and Geist Mono at the weights the app loads (public/index.html).
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

loadGeist("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
loadGeistMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });

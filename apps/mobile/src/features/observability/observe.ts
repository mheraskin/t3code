import { Observe } from "expo-observe";

// Crash reports went to T3 Connect's relay, which this build no longer uses. Observe's native side
// keeps the last configuration across launches, so an install that had reports on turns them off.
Observe.configure({ dispatchingEnabled: false });

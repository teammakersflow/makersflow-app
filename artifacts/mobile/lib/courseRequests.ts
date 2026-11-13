/**
 * The app's single instance of the shared course data sources
 * (lib/courseRequestSources.ts). Every screen and repository that needs a
 * course's lesson progress, or the /modules and /lessons lists, goes through
 * this instance, so concurrent screens share one request per window.
 */
import { apiClient } from '@/lib/auth/apiClient';
import { createCourseRequestSources } from '@/lib/courseRequestSources';

export const courseRequests = createCourseRequestSources({
  getJson: (path) => apiClient.get<any>(path),
});

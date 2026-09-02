import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Accordion, Modal } from 'react-bootstrap';
import { Button, LinearProgress } from '@mui/material';
import ReactPlayer from 'react-player';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import axiosInstance, {
  resolveCourseVideoUrl,
} from '../../common/AxiosInstance';
import { UserContext } from '../../../App';
import NavBar from '../../common/NavBar';
import Toast from '../../common/Toast';
import BookmarkButton from '../../bookmarks/BookmarkButton';
import CourseReviews from '../../reviews/CourseReviews';
import usePlaybackToken from '../../../hooks/usePlaybackToken';
import '../../../styles/course-player.css';
import {
  PROGRESS_STATES,
  describeProgress,
  formatCertificateDate,
  progressState,
  readCertificateDate,
  readIsComplete,
  readProgress,
  readSections,
  sectionAddress,
} from '../../../lib/courseProgress';
import {
  CERTIFICATE_FILENAME,
  RENDER_SCALE,
  computeCertificateLayout,
  readImageFormat,
} from '../../../lib/certificatePdf';

// #93. Three things were wrong here and they compounded:
//
//   * the Completed button sat inside `{section.S_content && ...}`, so a
//     section with no video had no control to complete it and the certificate
//     could never be reached;
//   * completion was decided in the browser with
//     `completedModule.length === courseContent.length`, over an array that
//     can hold duplicates and ids for sections the course no longer has;
//   * the certificate was dated `certficateData.updatedAt`, the enrolment's
//     last-write timestamp, which moves every time progress is saved.
//
// The server answers all three now. This component renders what it is told.

const PROGRESS_COLOR = {
  [PROGRESS_STATES.COMPLETE]: 'success',
  [PROGRESS_STATES.IN_PROGRESS]: 'primary',
  [PROGRESS_STATES.NOT_STARTED]: 'inherit',
};

const EMPTY_TOAST = { message: '', type: 'info' };

const CourseContent = () => {
  const user = useContext(UserContext);
  const { courseId, courseTitle } = useParams();

  const [sections, setSections] = useState([]);
  const [progress, setProgress] = useState({
    completed: 0,
    total: 0,
    percent: 0,
  });
  const [isComplete, setIsComplete] = useState(false);
  const [certificateDate, setCertificateDate] = useState(null);
  const [serverTitle, setServerTitle] = useState('');
  // Minted by /coursecontent once it has confirmed this viewer is enrolled
  // (#76). Scoped to this course, good for half an hour, and the only thing
  // that opens the video route now that /uploads is not served.
  //
  // #124. It used to be plain useState, set once when the page loaded and
  // never touched again. Half an hour later the stream route began refusing
  // it, and because a <video> element's request does not pass through the
  // axios interceptor the 401 was silent: an empty player and an empty
  // console. The hook renews it ahead of the deadline and again at the moment
  // a section is played, which is the check that survives a throttled timer in
  // a background tab.
  const {
    token: playbackToken,
    error: playbackError,
    adopt: adoptPlaybackToken,
    ensureFresh: ensureFreshPlaybackToken,
  } = usePlaybackToken(courseId);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingSection, setSavingSection] = useState(null);
  const [toast, setToast] = useState(EMPTY_TOAST);

  const [activeVideo, setActiveVideo] = useState(null);
  const [showModal, setShowModal] = useState(false);
  // Rasterising the certificate takes a noticeable moment, and the button used
  // to give no sign of it — which invited a second click and a second render of
  // the same node (#134).
  const [downloading, setDownloading] = useState(false);

  const dismissToast = useCallback(() => setToast(EMPTY_TOAST), []);

  const applyPayload = useCallback((payload) => {
    setSections(readSections(payload));
    setProgress(readProgress(payload));
    setIsComplete(readIsComplete(payload));
    setCertificateDate(readCertificateDate(payload));
    setServerTitle(payload?.courseTitle || '');
    // This response already carries a freshly minted token and its expiry, so
    // it is adopted rather than followed by a second request for the same
    // thing.
    adoptPlaybackToken(payload);
  }, [adoptPlaybackToken]);

  const getCourseContent = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      const res = await axiosInstance.get(
        `/api/user/coursecontent/${courseId}`,
      );

      if (res.data?.success) {
        applyPayload(res.data);
      } else {
        setLoadError(res.data?.message || 'This course could not be opened.');
      }
    } catch (error) {
      // Previously a bare console.log, which left an empty accordion and no
      // explanation — the same shape of bug #85 fixed one screen over.
      setLoadError(
        error.response?.data?.message || 'This course could not be opened.',
      );
    } finally {
      setLoading(false);
    }
  }, [applyPayload, courseId]);

  useEffect(() => {
    getCourseContent();
  }, [getCourseContent]);

  // Awaited before the player is pointed at the file (#124). A viewer who
  // opened the page two hours ago and is only now clicking a section gets a
  // token that works, instead of a silent 401 on the stream.
  const playVideo = async (section) => {
    // The guarded stream URL the API returned for this section. The component
    // used to build `${host}/uploads/${path}` itself, which stopped working
    // when the upload directory was taken off the static handler (#76).
    const { streamUrl } = section;

    if (!streamUrl) return;

    await ensureFreshPlaybackToken();

    setActiveVideo({
      streamUrl,
      index: section.index,
      title: section.title,
    });
  };

  const completeSection = async (section) => {
    if (section.completed || savingSection !== null) return;

    setSavingSection(section.index);

    try {
      const res = await axiosInstance.post('/api/user/completemodule', {
        courseId,
        sectionId: sectionAddress(section),
      });

      if (!res.data?.success) {
        setToast({
          message: res.data?.message || 'That section could not be saved.',
          type: 'error',
        });
        return;
      }

      // The response carries the recomputed summary and the certificate date,
      // so the common case needs no second request.
      setProgress(readProgress(res.data));
      setIsComplete(readIsComplete(res.data));
      setCertificateDate(readCertificateDate(res.data));
      setSections((current) =>
        current.map((entry) =>
          entry.index === section.index ? { ...entry, completed: true } : entry,
        ),
      );

      setToast({
        message: res.data.alreadyCompleted
          ? 'You had already completed that section.'
          : `“${section.title}” marked complete.`,
        type: 'success',
      });
    } catch (error) {
      setToast({
        message:
          error.response?.data?.message ||
          'That section could not be saved. Please try again.',
        type: 'error',
      });
    } finally {
      setSavingSection(null);
    }
  };

  // The placement is computed from the canvas rather than hardcoded. The old
  // call passed neither a width nor a height, so jsPDF read the bitmap's pixel
  // dimensions and used them as millimetres — a ~700 mm image on a 210 mm page
  // — and the x = -35 beside it was an attempt to centre that overflow by hand
  // (#134).
  const downloadPdfDocument = async (rootElementId) => {
    if (downloading) return;

    const input = document.getElementById(rootElementId);

    if (!input) {
      setToast({
        message: 'The certificate is not ready yet. Please try again.',
        type: 'error',
      });
      return;
    }

    setDownloading(true);

    try {
      // Pinned, rather than html2canvas's default of window.devicePixelRatio,
      // so the PDF does not depend on the display it was generated on.
      const canvas = await html2canvas(input, {
        scale: RENDER_SCALE,
        backgroundColor: '#ffffff',
      });

      const layout = computeCertificateLayout(canvas);

      if (!layout) {
        throw new Error('The certificate produced an empty canvas');
      }

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF();

      pdf.addImage(
        imgData,
        // Read off the data URI. The old call declared JPEG for a PNG.
        readImageFormat(imgData),
        layout.x,
        layout.y,
        layout.width,
        layout.height,
      );
      pdf.save(CERTIFICATE_FILENAME);

      setToast({ message: 'Certificate downloaded.', type: 'success' });
    } catch (error) {
      // There was no catch at all before, so a failed render was an unhandled
      // rejection and a button that silently did nothing.
      console.error('Unable to build the certificate PDF:', error);
      setToast({
        message: 'The certificate could not be downloaded. Please try again.',
        type: 'error',
      });
    } finally {
      setDownloading(false);
    }
  };

  const state = progressState(progress);
  const title = serverTitle || courseTitle;
  const awardedOn = useMemo(
    () => formatCertificateDate(certificateDate),
    [certificateDate],
  );

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="course-state" role="status">
          <span className="catalog-loader" aria-hidden="true" />
          <h3>Opening the course…</h3>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <NavBar />
        <div className="course-state course-state-error" role="alert">
          <h3>This course could not be opened</h3>
          <p>{loadError}</p>
          <button
            type="button"
            className="button button-ink"
            onClick={getCourseContent}
          >
            Try again
          </button>
          <Link className="button button-outline" to="/dashboard">
            Back to my courses
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar />

      <header className="course-player-header">
        <h1 className="my-3 text-center">Welcome to the course: {title}</h1>
        <BookmarkButton courseId={courseId} />

        {/* The API has computed this per enrolment since #65 and the player
            never showed it. */}
        <div className="course-player-progress">
          <LinearProgress
            variant="determinate"
            value={progress.percent}
            color={PROGRESS_COLOR[state]}
            aria-label={`${progress.percent}% complete`}
            sx={{ height: 8, borderRadius: 4, marginBottom: '6px' }}
          />
          <small aria-live="polite">
            {describeProgress(progress)}
            {progress.total > 0 ? ` · ${progress.percent}%` : ''}
          </small>
        </div>
      </header>

      <div className="course-content">
        <div className="course-section">
          <Accordion defaultActiveKey="0" flush>
            {sections.map((section) => (
              <Accordion.Item
                key={section.sectionId || section.index}
                eventKey={String(section.index)}
              >
                <Accordion.Header>
                  {section.title}
                  {section.completed ? (
                    <span className="section-complete-tick" aria-label="Completed">
                      {' '}
                      ✓
                    </span>
                  ) : null}
                </Accordion.Header>
                <Accordion.Body>
                  <p>{section.description}</p>

                  {/* Only the video button depends on there being a video. */}
                  {section.hasVideo ? (
                    <Button
                      color="success"
                      className="mx-2"
                      variant="text"
                      size="small"
                      onClick={() => playVideo(section)}
                    >
                      Play Video
                    </Button>
                  ) : (
                    <small className="section-no-video">
                      This section has no video.
                    </small>
                  )}

                  {/* And this one depends on nothing but whether it is done. */}
                  {section.completed ? (
                    <small className="section-complete-note">Completed</small>
                  ) : (
                    <Button
                      variant="contained"
                      color="success"
                      size="small"
                      onClick={() => completeSection(section)}
                      disabled={savingSection !== null}
                    >
                      {savingSection === section.index
                        ? 'Saving…'
                        : 'Mark complete'}
                    </Button>
                  )}
                </Accordion.Body>
              </Accordion.Item>
            ))}
          </Accordion>

          {sections.length === 0 ? (
            <div className="course-state" role="status">
              <h3>This course has no sections yet</h3>
              <p>The educator has not published any content for it.</p>
            </div>
          ) : null}

          {isComplete ? (
            <Button
              className="my-2"
              variant="contained"
              onClick={() => setShowModal(true)}
            >
              Download Certificate
            </Button>
          ) : null}
        </div>

        <div className="course-video w-50">
          {/* The failure this replaces had no symptom at all. If access
              cannot be renewed, say so. */}
          {playbackError ? (
            <p className="course-state course-state-error" role="alert">
              {playbackError}
            </p>
          ) : null}
          {activeVideo && playbackToken ? (
            <ReactPlayer
              url={resolveCourseVideoUrl(activeVideo.streamUrl, playbackToken)}
              width="100%"
              height="100%"
              controls
            />
          ) : (
            <p className="course-video-placeholder">
              Choose a section to start watching.
            </p>
          )}
        </div>
      </div>

      {/* On the page rather than inside the certificate modal. The modal only
          opens behind a 100%-completion check, so a student nine sections into
          ten was authorised by the API — which asks for enrolment and nothing
          else — and had no way to leave a review (#136). */}
      <section className="course-player-reviews">
        <CourseReviews courseId={courseId} courseTitle={title} />
      </section>

      <Modal
        size="lg"
        show={showModal}
        onHide={() => setShowModal(false)}
        dialogClassName="modal-90w"
        aria-labelledby="certificate-modal-title"
      >
        <Modal.Header closeButton>
          <Modal.Title id="certificate-modal-title">
            Completion Certificate
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Congratulations! You have completed all {progress.total} sections.
          </p>

          <div id="certificate-download" className="certificate text-center">
            <h1>Certificate of Completion</h1>
            <div className="content">
              <p>This is to certify that</p>
              <h2>{user?.userData?.name}</h2>
              <p>has successfully completed the course</p>
              <h3>{title}</h3>
              {awardedOn ? (
                <>
                  <p>on</p>
                  {/* Stamped server-side when the last section was completed,
                      rather than read off the enrolment's updatedAt. */}
                  <p className="date">{awardedOn}</p>
                </>
              ) : null}
            </div>
          </div>

          <Button
            onClick={() => downloadPdfDocument('certificate-download')}
            disabled={downloading}
            style={{ float: 'right', marginTop: 3 }}
          >
            {downloading ? 'Preparing…' : 'Download Certificate'}
          </Button>
        </Modal.Body>
      </Modal>

      {/* alert() blocked the tab on every completion and was not announced to
          assistive technology. Toast was added in #36 for this. */}
      <Toast message={toast.message} type={toast.type} onClose={dismissToast} />
    </>
  );
};

export default CourseContent;

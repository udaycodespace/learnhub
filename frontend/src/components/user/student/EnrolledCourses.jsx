import { useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import {
  Button,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  styled,
  tableCellClasses,
} from '@mui/material';

import axiosInstance from '../../common/AxiosInstance';
import CatalogPager from '../../common/CatalogPager';
import Toast from '../../common/Toast';
import useEnrolledCourses from '../../../hooks/useEnrolledCourses';
import '../../../styles/enrolled-courses.css';
import {
  PROGRESS_STATES,
  courseHref,
  describeEnrolledRange,
  describeProgress,
  describeWithdrawal,
  formatEnrolledDate,
  progressState,
  readProgress,
} from '../../../lib/enrolledCourses';

// #65 made GET /api/user/getallcoursesuser paginated and gave every row a
// progress summary. This table called it bare and read two fields off each
// row, so enrolment thirteen was unreachable and the progress the server had
// already computed was never shown. The Course ID column, meanwhile, was the
// widest thing on screen and of no use to a learner.

const StyledTableCell = styled(TableCell)(({ theme }) => ({
   [`&.${tableCellClasses.head}`]: {
      backgroundColor: theme.palette.common.black,
      color: theme.palette.common.white,
   },
   [`&.${tableCellClasses.body}`]: {
      fontSize: 14,
   },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
   '&:nth-of-type(odd)': {
      backgroundColor: theme.palette.action.hover,
   },
   // hide last border
   '&:last-child td, &:last-child th': {
      border: 0,
   },
}));

const PROGRESS_COLOR = {
   [PROGRESS_STATES.COMPLETE]: 'success',
   [PROGRESS_STATES.IN_PROGRESS]: 'primary',
   [PROGRESS_STATES.NOT_STARTED]: 'inherit',
};

const ProgressCell = ({ row }) => {
   const progress = readProgress(row);
   const state = progressState(progress);

   return (
      <div className="enrolled-progress">
         <LinearProgress
            variant="determinate"
            value={progress.percent}
            color={PROGRESS_COLOR[state]}
            aria-label={`${progress.percent}% complete`}
            sx={{ height: 8, borderRadius: 4, marginBottom: '6px' }}
         />
         <small>
            {describeProgress(progress)}
            {progress.total > 0 ? ` · ${progress.percent}%` : ''}
         </small>
      </div>
   );
};

ProgressCell.propTypes = {
   row: PropTypes.shape({
      progress: PropTypes.shape({
         completed: PropTypes.number,
         total: PropTypes.number,
         percent: PropTypes.number,
      }),
      courseLength: PropTypes.number,
   }).isRequired,
};

const EMPTY_TOAST = { message: '', type: 'info' };

const EnrolledCourses = () => {
   const { courses, pagination, loading, error, goToPage, reload } =
      useEnrolledCourses();

   // #128. There was no way to leave a course. An enrolment row was only ever
   // created; the only deletes are in the cascade, for a deleted course or a
   // deleted account. A free course enrols on one click with no confirmation —
   // handleEnroll skips the payment modal entirely for a free course — so a
   // mis-click stayed on this table for the life of the account, and kept
   // inflating the learner count the catalogue sorts "popular" by.
   const [pendingLeave, setPendingLeave] = useState(null);
   const [leavingId, setLeavingId] = useState(null);
   const [toast, setToast] = useState(EMPTY_TOAST);

   const confirmLeave = async () => {
      const course = pendingLeave;

      if (!course) return;

      setPendingLeave(null);
      setLeavingId(course._id);

      try {
         const res = await axiosInstance.delete(
            `/api/user/enrolledcourse/${course._id}`,
         );

         if (res.data?.success) {
            setToast({
               message: `You have left “${course.C_title}”.`,
               type: 'success',
            });
            reload();
         } else {
            setToast({
               message: res.data?.message || 'You could not be removed from the course.',
               type: 'error',
            });
         }
      } catch (requestError) {
         // A 401 is handled by the axios interceptor, which clears the session
         // and redirects; reporting it here would only flash a message on the
         // way out.
         if (requestError.response?.status !== 401) {
            setToast({
               message:
                  requestError.response?.data?.message ||
                  'You could not be removed from the course.',
               type: 'error',
            });
         }
      } finally {
         setLeavingId(null);
      }
   };

   if (loading && courses.length === 0) {
      return (
         <div className="course-state" role="status">
            <span className="catalog-loader" aria-hidden="true" />
            <h3>Loading your courses…</h3>
         </div>
      );
   }

   // A failed request used to be a console.log and a permanently empty table.
   if (error) {
      return (
         <div className="course-state course-state-error" role="alert">
            <h3>Your courses could not be loaded</h3>
            <p>{error}</p>
            <button type="button" className="button button-ink" onClick={reload}>
               Try again
            </button>
         </div>
      );
   }

   if (courses.length === 0) {
      return (
         <div className="course-state">
            <h3>You have not enrolled in a course yet</h3>
            <p>Browse the catalogue and enrol to see your progress here.</p>
         </div>
      );
   }

   return (
      <>
         <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(EMPTY_TOAST)}
         />

         <TableContainer component={Paper}>
            <Table sx={{ minWidth: 700 }} aria-label="Enrolled courses">
               <TableHead>
                  <TableRow>
                     <StyledTableCell>Course</StyledTableCell>
                     <StyledTableCell align="left">Educator</StyledTableCell>
                     <StyledTableCell align="left">Category</StyledTableCell>
                     <StyledTableCell align="left">Progress</StyledTableCell>
                     <StyledTableCell align="left">Enrolled</StyledTableCell>
                     <StyledTableCell align="left">Action</StyledTableCell>
                  </TableRow>
               </TableHead>
               <TableBody>
                  {courses.map((course) => (
                     <StyledTableRow key={course._id}>
                        <StyledTableCell component="th" scope="row">
                           {course.C_title}
                        </StyledTableCell>
                        <StyledTableCell>{course.C_educator}</StyledTableCell>
                        <StyledTableCell>{course.C_categories}</StyledTableCell>
                        <StyledTableCell>
                           <ProgressCell row={course} />
                        </StyledTableCell>
                        <StyledTableCell>
                           {formatEnrolledDate(course.enrolledAt) || '—'}
                        </StyledTableCell>
                        <StyledTableCell>
                           <div className="enrolled-actions">
                              {/* The title used to be interpolated into the
                                  path unencoded, so a course called "HTTP/2 in
                                  practice" produced a URL with an extra segment
                                  and the route matched something else. */}
                              <Link to={courseHref(course)}>
                                 <Button size="small" variant="contained" color="success">
                                    Go To
                                 </Button>
                              </Link>
                              <Button
                                 size="small"
                                 variant="outlined"
                                 color="inherit"
                                 onClick={() => setPendingLeave(course)}
                                 disabled={leavingId === course._id}
                              >
                                 {leavingId === course._id ? 'Leaving…' : 'Leave'}
                              </Button>
                           </div>
                        </StyledTableCell>
                     </StyledTableRow>
                  ))}
               </TableBody>
            </Table>
         </TableContainer>

         <p className="catalog-range" aria-live="polite">
            {describeEnrolledRange(pagination, courses.length)}
         </p>

         <CatalogPager
            pagination={pagination}
            onPageChange={goToPage}
            disabled={loading}
            label="Enrolled course pages"
         />

         {/* An in-page confirmation rather than a native confirm(), the
             pattern TeacherHome already uses for deleting a course: confirm()
             blocks the tab and is not announced to assistive technology.
             Leaving is not reversible, and what goes and what stays is not
             obvious, so both are named. */}
         {pendingLeave ? (
            <div
               className="leave-confirm"
               role="alertdialog"
               aria-modal="true"
               aria-labelledby="leave-course-title"
            >
               <div className="leave-confirm-panel">
                  <h3 id="leave-course-title">Leave this course?</h3>
                  <p>“{pendingLeave.C_title}” will be removed from your courses.</p>
                  <ul className="leave-course-consequences">
                     {describeWithdrawal(pendingLeave).map((line) => (
                        <li key={line}>{line}</li>
                     ))}
                  </ul>
                  <div className="leave-confirm-actions">
                     <Button
                        variant="outlined"
                        color="inherit"
                        onClick={() => setPendingLeave(null)}
                        autoFocus
                     >
                        Cancel
                     </Button>
                     <Button variant="contained" color="error" onClick={confirmLeave}>
                        Leave course
                     </Button>
                  </div>
               </div>
            </div>
         ) : null}
      </>
   );
};

export default EnrolledCourses;

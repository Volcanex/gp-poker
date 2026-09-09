import { Link, useLocation } from 'react-router-dom';
import { Users } from '@phosphor-icons/react/dist/icons/Users';
import { useFriends } from '../net/friends.tsx';

/* The one thing in the top bar that is about somebody else waiting on you: a
   friend request to answer, or a table a friend has already made. It is a
   count and not a list, so it says how many and where to go and nothing else.

   **Nothing to act on, nothing in the bar.** An outgoing request is not
   counted, because there is nothing to do about one somebody else has yet to
   answer, and a zero is drawn as no badge rather than as a nought: a bar that
   always carried this would be a bar with a permanent nought in it. It also
   hides on the friends page itself, where it would point at the page being
   read, the same rule the playing pill follows. */
export function FriendsBadge() {
  const { waiting } = useFriends();
  const { pathname } = useLocation();
  if (waiting === 0 || pathname === '/friends') return null;
  const label = waiting === 1 ? '1 friend request or invite waiting' : `${waiting} friend requests or invites waiting`;
  return (
    <Link className="friends-badge" to="/friends" aria-label={label} title={label}>
      <Users size={16} aria-hidden="true" />
      <span className="num">{waiting}</span>
    </Link>
  );
}

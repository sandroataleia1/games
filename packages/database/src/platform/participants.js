// Platform participation in a match: who took part and whether they left.
// No score/answers/ranking here - those are the game's own state, keyed by the
// same id (Participant for the Quiz). Host is not a participant role: a match's
// host is a nullable reference (GameSession.hostUserId), so the same account can
// host and be a participant at once.
export function createPlatformParticipants() {
  return {
    add(db, { matchId, userId = null }) {
      return db.matchParticipant.create({ data: { gameSessionId: matchId, userId } });
    },
    // A dropped connection is not a leave: only this marks explicit abandonment.
    markLeft(db, id, matchId) {
      return db.matchParticipant.update({ where: { id_gameSessionId: { id, gameSessionId: matchId } }, data: { leftAt: new Date() } });
    },
    markPresent(db, id, matchId) {
      return db.matchParticipant.update({ where: { id_gameSessionId: { id, gameSessionId: matchId } }, data: { leftAt: null } });
    },
  };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReactionTargetType = exports.EmojiType = exports.AuditType = exports.AnnounceType = void 0;
var AnnounceType;
(function (AnnounceType) {
    AnnounceType[AnnounceType["Member"] = 0] = "Member";
    AnnounceType[AnnounceType["WelCome"] = 1] = "WelCome";
})(AnnounceType || (exports.AnnounceType = AnnounceType = {}));
var AuditType;
(function (AuditType) {
    AuditType[AuditType["Thread"] = 1] = "Thread";
    AuditType[AuditType["Post"] = 2] = "Post";
    AuditType[AuditType["Reply"] = 3] = "Reply";
})(AuditType || (exports.AuditType = AuditType = {}));
var EmojiType;
(function (EmojiType) {
    EmojiType[EmojiType["System"] = 1] = "System";
    EmojiType[EmojiType["Emoji"] = 2] = "Emoji";
})(EmojiType || (exports.EmojiType = EmojiType = {}));
var ReactionTargetType;
(function (ReactionTargetType) {
    ReactionTargetType[ReactionTargetType["Message"] = 0] = "Message";
    ReactionTargetType[ReactionTargetType["Thread"] = 1] = "Thread";
    ReactionTargetType[ReactionTargetType["Comment"] = 2] = "Comment";
    ReactionTargetType[ReactionTargetType["Reply"] = 3] = "Reply";
    ReactionTargetType["ReactionTargetType_MSG"] = "ReactionTargetType_MSG";
})(ReactionTargetType || (exports.ReactionTargetType = ReactionTargetType = {}));

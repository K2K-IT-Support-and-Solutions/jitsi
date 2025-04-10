import React, { Component, useRef, useEffect,useState } from 'react';
import { connect } from 'react-redux';
import * as tf from '@tensorflow/tfjs';
import * as facemesh from '@tensorflow-models/facemesh';

// @ts-expect-error
import VideoLayout from '../../../../modules/UI/videolayout/VideoLayout';
import { IReduxState, IStore } from '../../app/types';
import { isDisplayNameVisible } from '../../base/config/functions.web';
import { VIDEO_TYPE } from '../../base/media/constants';
import { getLocalParticipant } from '../../base/participants/functions';
import Watermarks from '../../base/react/components/web/Watermarks';
import { getHideSelfView } from '../../base/settings/functions.any';
import { getVideoTrackByParticipant } from '../../base/tracks/functions.web';
import { setColorAlpha } from '../../base/util/helpers';
import StageParticipantNameLabel from '../../display-name/components/web/StageParticipantNameLabel';
import { FILMSTRIP_BREAKPOINT } from '../../filmstrip/constants';
import { getVerticalViewMaxWidth, isFilmstripResizable } from '../../filmstrip/functions.web';
import SharedVideo from '../../shared-video/components/web/SharedVideo';
import Captions from '../../subtitles/components/web/Captions';
import { setTileView } from '../../video-layout/actions.web';
import Whiteboard from '../../whiteboard/components/web/Whiteboard';
import { isWhiteboardEnabled } from '../../whiteboard/functions';
import { setSeeWhatIsBeingShared } from '../actions.web';
import { getLargeVideoParticipant } from '../functions';

import ScreenSharePlaceholder from './ScreenSharePlaceholder.web';
const styles = {
    largeVideoContainer: {
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
    },
    videoWrapper: {
        position: 'relative',
        width: '100%',
        height: '100%',
        zIndex: 1
    },
    videoElement: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        zIndex: 1
    },
    faceMaskCanvas: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '200%',
        height: '200%',
        pointerEvents: 'none',
        zIndex: 2
    },
    debugOverlay: {
        position: 'absolute',
        top: 10,
        left: 10,
        backgroundColor: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '5px',
        fontSize: '12px',
        zIndex: 3
    }
};

interface FaceMaskOverlayProps {
    videoElement: HTMLVideoElement | null;
    debugMode?: boolean;
}

const FaceMaskOverlay: React.FC<FaceMaskOverlayProps> = ({ videoElement, debugMode = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const modelRef = useRef<facemesh.FaceMesh | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const [currentFilter, setCurrentFilter] = useState<number>(0); // 0=glasses, 1=mustache, 2=cat ears

    // Apply a random filter every 5 seconds
    useEffect(() => {
        const filterInterval = setInterval(() => {
            setCurrentFilter(Math.floor(Math.random() * 3));
        }, 5000);
        return () => clearInterval(filterInterval);
    }, []);

    const drawGlasses = (ctx: CanvasRenderingContext2D, prediction: facemesh.AnnotatedPrediction) => {
        alert('Glasses filter is not implemented yet.');
        const leftEye = prediction.annotations.leftEyeUpper0;
        const rightEye = prediction.annotations.rightEyeUpper0;
        
        if (!leftEye || !rightEye) return;

        // Frame
        ctx.fillStyle = 'rgba(100, 100, 255, 0.7)';
        ctx.beginPath();
        leftEye.forEach((point, i) => {
            if (i === 0) ctx.moveTo(point[0], point[1]);
            else ctx.lineTo(point[0], point[1]);
        });
        rightEye.forEach((point, i) => {
            ctx.lineTo(point[0], point[1]);
        });
        ctx.closePath();
        ctx.fill();
        
        // Bridge
        const leftCenter = leftEye[Math.floor(leftEye.length/2)];
        const rightCenter = rightEye[Math.floor(rightEye.length/2)];
        ctx.strokeStyle = 'rgba(50, 50, 150, 0.9)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(leftCenter[0], leftCenter[1]);
        ctx.lineTo(rightCenter[0], rightCenter[1]);
        ctx.stroke();
    };

    
    
    const drawMustache = (ctx: CanvasRenderingContext2D, prediction: facemesh.AnnotatedPrediction) => {
        const noseBottom = prediction.annotations.noseBottom?.[0];
        const upperLip = prediction.annotations.upperLip?.[0];
        
        if (!noseBottom || !upperLip) return;

        const width = Math.abs(upperLip[0] - noseBottom[0]) * 2;
        const height = width * 0.3;
        
        ctx.fillStyle = 'rgba(50, 50, 50, 0.9)';
        ctx.beginPath();
        ctx.ellipse(
            noseBottom[0], 
            noseBottom[1] + height/2, 
            width/2, 
            height/2, 
            0, 0, Math.PI * 2
        );
        ctx.fill();
    };

    const drawCatEars = (ctx: CanvasRenderingContext2D, prediction: facemesh.AnnotatedPrediction) => {
        const forehead = prediction.annotations.forehead?.[0];
        const leftEyebrow = prediction.annotations.leftEyebrow?.[0];
        const rightEyebrow = prediction.annotations.rightEyebrow?.[0];
        
        if (!forehead || !leftEyebrow || !rightEyebrow) return;

        const earHeight = Math.abs(forehead[1] - leftEyebrow[1]) * 1.5;
        
        // Left ear
        ctx.fillStyle = 'rgba(255, 150, 150, 0.7)';
        ctx.beginPath();
        ctx.moveTo(leftEyebrow[0], leftEyebrow[1]);
        ctx.lineTo(leftEyebrow[0] - earHeight/2, leftEyebrow[1] - earHeight);
        ctx.lineTo(leftEyebrow[0] + earHeight/2, leftEyebrow[1] - earHeight);
        ctx.closePath();
        ctx.fill();
        
        // Right ear
        ctx.beginPath();
        ctx.moveTo(rightEyebrow[0], rightEyebrow[1]);
        ctx.lineTo(rightEyebrow[0] - earHeight/2, rightEyebrow[1] - earHeight);
        ctx.lineTo(rightEyebrow[0] + earHeight/2, rightEyebrow[1] - earHeight);
        ctx.closePath();
        ctx.fill();
    };

    const drawMasks = (predictions: facemesh.AnnotatedPrediction[]) => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || !canvasRef.current) return;

        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        if (predictions.length === 0) return;

        predictions.forEach(prediction => {
            try {
                switch(currentFilter) {
                    case 0: 
                        drawGlasses(ctx, prediction);
                        break;
                    case 1:
                        drawMustache(ctx, prediction);
                        break;
                    case 2:
                        drawCatEars(ctx, prediction);
                        break;
                }
            } catch (error) {
                console.error('Error drawing filter:', error);
            }
        });

        if (debugMode) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(10, 10, 200, 30);
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.fillText(`Filter: ${['Glasses', 'Mustache', 'Cat Ears'][currentFilter]}`, 20, 30);
        }
    };

    const predict = async () => {
        if (!modelRef.current || !videoElement || !canvasRef.current || videoElement.readyState < 2) {
            return;
        }

        try {
            // Update canvas dimensions to match video
            if (canvasRef.current.width !== videoElement.videoWidth || 
                canvasRef.current.height !== videoElement.videoHeight) {
                canvasRef.current.width = videoElement.videoWidth;
                canvasRef.current.height = videoElement.videoHeight;
            }

            const predictions = await modelRef.current.estimateFaces(videoElement);
            drawMasks(predictions);
        } catch (error) {
            console.error('Face detection error:', error);
        }

        animationFrameRef.current = requestAnimationFrame(predict);
    };

    const loadModel = async () => {
        try {
            await tf.ready();
            modelRef.current = await facemesh.load({
                maxFaces: 1,
                inputResolution: { width: 320, height: 240 },
                detectionConfidence: 0.7
            });
            predict();
        } catch (error) {
            console.error('Model loading failed:', error);
        }
    };

    useEffect(() => {
        if (videoElement) {
            if (videoElement.readyState >= 2) {
                loadModel();
            } else {
                const handleCanPlay = () => loadModel();
                videoElement.addEventListener('canplay', handleCanPlay);
                return () => videoElement.removeEventListener('canplay', handleCanPlay);
            }
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (modelRef.current) {
                modelRef.current.dispose();
            }
        };
    }, [videoElement]);

    return (
        <canvas 
            ref={canvasRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2
            }}
        />
    );
};

// Hack to detect Spot.
const SPOT_DISPLAY_NAME = 'Meeting Room';

interface IProps {
    /**
     * The alpha(opacity) of the background.
     */
    _backgroundAlpha?: number;

    /**
     * The user selected background color.
     */
    _customBackgroundColor: string;

    /**
     * The user selected background image url.
     */
    _customBackgroundImageUrl: string;

    /**
     * Whether the screen-sharing placeholder should be displayed or not.
     */
    _displayScreenSharingPlaceholder: boolean;

    /**
     * Whether or not the hideSelfView is enabled.
     */
    _hideSelfView: boolean;

    /**
     * Prop that indicates whether the chat is open.
     */
    _isChatOpen: boolean;

    /**
     * Whether or not the display name is visible.
     */
    _isDisplayNameVisible: boolean;

    /**
     * Whether or not the local screen share is on large-video.
     */
    _isScreenSharing: boolean;

    /**
     * The large video participant id.
     */
    _largeVideoParticipantId: string;

    /**
     * Local Participant id.
     */
    _localParticipantId: string;

    /**
     * Used to determine the value of the autoplay attribute of the underlying
     * video element.
     */
    _noAutoPlayVideo: boolean;

    /**
     * Whether or not the filmstrip is resizable.
     */
    _resizableFilmstrip: boolean;

    /**
     * Whether or not the screen sharing is visible.
     */
    _seeWhatIsBeingShared: boolean;

    /**
     * Whether or not to show dominant speaker badge.
     */
    _showDominantSpeakerBadge: boolean;

    /**
     * The width of the vertical filmstrip (user resized).
     */
    _verticalFilmstripWidth?: number | null;

    /**
     * The max width of the vertical filmstrip.
     */
    _verticalViewMaxWidth: number;

    /**
     * Whether or not the filmstrip is visible.
     */
    _visibleFilmstrip: boolean;

    /**
     * Whether or not the whiteboard is ready to be used.
     */
    _whiteboardEnabled: boolean;

    /**
     * The Redux dispatch function.
     */
    dispatch: IStore['dispatch'];
}

class LargeVideo extends Component<IProps> {
    _tappedTimeout: number | undefined;
    _containerRef: React.RefObject<HTMLDivElement>;
    _wrapperRef: React.RefObject<HTMLDivElement>;
    _videoRef: React.RefObject<HTMLVideoElement>;

    constructor(props: IProps) {
        super(props);
        this._containerRef = React.createRef<HTMLDivElement>();
        this._wrapperRef = React.createRef<HTMLDivElement>();
        this._videoRef = React.createRef<HTMLVideoElement>();

        this._clearTapTimeout = this._clearTapTimeout.bind(this);
        this._onDoubleTap = this._onDoubleTap.bind(this);
        this._updateLayout = this._updateLayout.bind(this);
    }

    override componentDidUpdate(prevProps: IProps) {
        const {
            _visibleFilmstrip,
            _isScreenSharing,
            _seeWhatIsBeingShared,
            _largeVideoParticipantId,
            _hideSelfView,
            _localParticipantId } = this.props;

        if (prevProps._visibleFilmstrip !== _visibleFilmstrip) {
            this._updateLayout();
        }

        if (prevProps._isScreenSharing !== _isScreenSharing && !_isScreenSharing) {
            this.props.dispatch(setSeeWhatIsBeingShared(false));
        }

        if (_isScreenSharing && _seeWhatIsBeingShared) {
            VideoLayout.updateLargeVideo(_largeVideoParticipantId, true, true);
        }

        if (_largeVideoParticipantId === _localParticipantId
            && prevProps._hideSelfView !== _hideSelfView) {
            VideoLayout.updateLargeVideo(_largeVideoParticipantId, true, false);
        }
    }

    override render() {
        const {
            _displayScreenSharingPlaceholder,
            _isChatOpen,
            _isDisplayNameVisible,
            _noAutoPlayVideo,
            _showDominantSpeakerBadge,
            _whiteboardEnabled
        } = this.props;
        const style = this._getCustomStyles();
        const className = `videocontainer${_isChatOpen ? ' shift-right' : ''}`;

        return (
            <div
                className={className}
                id="largeVideoContainer"
                ref={this._containerRef}
                style={style}>
                <SharedVideo />
                {_whiteboardEnabled && <Whiteboard />}
                <div id="etherpad" />

                <Watermarks />

                <div
                    id="dominantSpeaker"
                    onTouchEnd={this._onDoubleTap}>
                    <div className="dynamic-shadow" />
                    <div id="dominantSpeakerAvatarContainer" />
                </div>
                <div id="remotePresenceMessage" />
                <span id="remoteConnectionMessage" />
                <div id="largeVideoElementsContainer">
                    <div id="largeVideoBackgroundContainer" />
                    {_displayScreenSharingPlaceholder ? <ScreenSharePlaceholder /> : <></>}
                    <div
                        id="largeVideoWrapper"
                        onTouchEnd={this._onDoubleTap}
                        ref={this._wrapperRef}
                        role="figure">
                        <video
                            ref={this._videoRef}
                            autoPlay={!_noAutoPlayVideo}
                            id="largeVideo"
                            muted={true}
                            playsInline={true} />
                       {this._videoRef.current && <FaceMaskOverlay videoElement={this._videoRef.current} debugMode={true} />}
                    </div>
                </div>
                {interfaceConfig.DISABLE_TRANSCRIPTION_SUBTITLES || <Captions />}
                {_isDisplayNameVisible && _showDominantSpeakerBadge && <StageParticipantNameLabel />}
            </div>
        );
    }

    _updateLayout() {
        const { _verticalFilmstripWidth, _resizableFilmstrip } = this.props;

        if (_resizableFilmstrip && Number(_verticalFilmstripWidth) >= FILMSTRIP_BREAKPOINT) {
            this._containerRef.current?.classList.add('transition');
            this._wrapperRef.current?.classList.add('transition');
            VideoLayout.refreshLayout();

            setTimeout(() => {
                this._containerRef?.current?.classList.remove('transition');
                this._wrapperRef?.current?.classList.remove('transition');
            }, 1000);
        } else {
            VideoLayout.refreshLayout();
        }
    }

    _clearTapTimeout() {
        clearTimeout(this._tappedTimeout);
        this._tappedTimeout = undefined;
    }

    _getCustomStyles() {
        const styles: any = {};
        const {
            _customBackgroundColor,
            _customBackgroundImageUrl,
            _verticalFilmstripWidth,
            _verticalViewMaxWidth,
            _visibleFilmstrip
        } = this.props;

        styles.backgroundColor = _customBackgroundColor || interfaceConfig.DEFAULT_BACKGROUND;

        if (this.props._backgroundAlpha !== undefined) {
            const alphaColor = setColorAlpha(styles.backgroundColor, this.props._backgroundAlpha);
            styles.backgroundColor = alphaColor;
        }

        if (_customBackgroundImageUrl) {
            styles.backgroundImage = `url(${_customBackgroundImageUrl})`;
            styles.backgroundSize = 'cover';
        }

        if (_visibleFilmstrip && Number(_verticalFilmstripWidth) >= FILMSTRIP_BREAKPOINT) {
            styles.width = `calc(100% - ${_verticalViewMaxWidth || 0}px)`;
        }

        return styles;
    }

    _onDoubleTap(e: React.TouchEvent) {
        e.stopPropagation();
        e.preventDefault();

        if (this._tappedTimeout) {
            this._clearTapTimeout();
            this.props.dispatch(setTileView(true));
        } else {
            this._tappedTimeout = window.setTimeout(this._clearTapTimeout, 300);
        }
    }
}

function _mapStateToProps(state: IReduxState) {
    const testingConfig = state['features/base/config'].testing;
    const { backgroundColor, backgroundImageUrl } = state['features/dynamic-branding'];
    const { isOpen: isChatOpen } = state['features/chat'];
    const { width: verticalFilmstripWidth, visible } = state['features/filmstrip'];
    const { defaultLocalDisplayName, hideDominantSpeakerBadge } = state['features/base/config'];
    const { seeWhatIsBeingShared } = state['features/large-video'];
    const localParticipantId = getLocalParticipant(state)?.id;
    const largeVideoParticipant = getLargeVideoParticipant(state);
    const videoTrack = getVideoTrackByParticipant(state, largeVideoParticipant);
    const isLocalScreenshareOnLargeVideo = largeVideoParticipant?.id?.includes(localParticipantId ?? '')
        && videoTrack?.videoType === VIDEO_TYPE.DESKTOP;
    const isOnSpot = defaultLocalDisplayName === SPOT_DISPLAY_NAME;

    return {
        _backgroundAlpha: state['features/base/config'].backgroundAlpha,
        _customBackgroundColor: backgroundColor,
        _customBackgroundImageUrl: backgroundImageUrl,
        _displayScreenSharingPlaceholder: Boolean(isLocalScreenshareOnLargeVideo && !seeWhatIsBeingShared && !isOnSpot),
        _hideSelfView: getHideSelfView(state),
        _isChatOpen: isChatOpen,
        _isDisplayNameVisible: isDisplayNameVisible(state),
        _isScreenSharing: Boolean(isLocalScreenshareOnLargeVideo),
        _largeVideoParticipantId: largeVideoParticipant?.id ?? '',
        _localParticipantId: localParticipantId ?? '',
        _noAutoPlayVideo: Boolean(testingConfig?.noAutoPlayVideo),
        _resizableFilmstrip: isFilmstripResizable(state),
        _seeWhatIsBeingShared: Boolean(seeWhatIsBeingShared),
        _showDominantSpeakerBadge: !hideDominantSpeakerBadge,
        _verticalFilmstripWidth: verticalFilmstripWidth.current,
        _verticalViewMaxWidth: getVerticalViewMaxWidth(state),
        _visibleFilmstrip: visible,
        _whiteboardEnabled: isWhiteboardEnabled(state)
    };
}

export default connect(_mapStateToProps)(LargeVideo);